import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import {
  PaintingPencilkitView,
  clearStrokesLog,
  getStrokesLog,
  type PaintingPencilkitReadyEvent,
  type PencilkitStrokeSummary,
} from '@hamster-note/painting-pencilkit';

/** 对外暴露的稳定 testID 集合，供真机验收与后续自动化引用 */
export const PENCILKIT_PROBE_TEST_IDS = {
  root: 'pencilkit-probe-root',
  canvas: 'pencilkit-probe-canvas',
  status: 'pencilkit-probe-status',
  strokes: 'pencilkit-probe-strokes',
  export: 'pencilkit-probe-export',
  clear: 'pencilkit-probe-clear',
} as const;

/** 屏幕上保留的最近笔迹条数（最新在前） */
const MAX_VISIBLE_STROKES = 12;

function formatStrokeLine(stroke: PencilkitStrokeSummary): string {
  const { counts, pressure, estimated } = stroke;
  const pressureText =
    pressure.capability === true
      ? `压力 ${pressure.min?.toFixed(3)}~${pressure.max?.toFixed(3)}`
      : pressure.capability === false
        ? '压力能力缺失'
        : '压力未判定';
  const flags = (stroke.cancelled ? ' [已取消]' : '') + (stroke.overflow ? ' [样本超限截断]' : '');
  return (
    `#${stroke.id} ${counts.total} 样本(主 ${counts.main} / 合 ${counts.coalesced}) ` +
    `down ${counts.down} up ${counts.up} · ${stroke.durationMs.toFixed(1)}ms · ` +
    `${pressureText} · 迟到估计 ${estimated.lateEstimateEvents}${flags}`
  );
}

/**
 * iOS `/pencilkit-probe` 路由实现（tasks 2.1/2.2 的 RN host 原型）。
 *
 * 验收点（见 docs/implementation/ios-pencilkit-surface/）：
 *   - 2.1：模块注册、onReady 六项、Pencil 可绘、手指默认不落墨、无 ToolPicker；
 *   - 2.2(G1)：每笔完成回传样本摘要（主/coalesced 计数、down/up、压力
 *     capability 与范围、迟到估计更新计数、取消/超限标志），「导出日志」
 *     经系统分享导出完整 JSON（含采样规则说明），不依赖 Console.app。
 *
 * 本文件只在 iOS bundle 中被 Metro 选用；Web/Android 由同目录基名文件
 * 提供说明页，不导入 @hamster-note/painting-pencilkit。
 */
export default function PencilkitProbeRoute() {
  const [ready, setReady] = useState<PaintingPencilkitReadyEvent | null>(null);
  const [strokes, setStrokes] = useState<PencilkitStrokeSummary[]>([]);
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'error'>('idle');

  const handleReady = useCallback((event: { nativeEvent: PaintingPencilkitReadyEvent }) => {
    setReady(event.nativeEvent);
  }, []);

  const handleStroke = useCallback((event: { nativeEvent: PencilkitStrokeSummary }) => {
    setStrokes((prev) => [event.nativeEvent, ...prev].slice(0, MAX_VISIBLE_STROKES));
  }, []);

  const handleExport = useCallback(async () => {
    setExportState('busy');
    try {
      const log = await getStrokesLog();
      await Share.share({ message: JSON.stringify(log) });
      setExportState('idle');
    } catch {
      setExportState('error');
    }
  }, []);

  const handleClear = useCallback(async () => {
    await clearStrokesLog();
    setStrokes([]);
  }, []);

  return (
    <View testID={PENCILKIT_PROBE_TEST_IDS.root} style={styles.container}>
      <View style={styles.statusBar}>
        <Text testID={PENCILKIT_PROBE_TEST_IDS.status} style={styles.statusTitle}>
          {ready ? '原生模块已就绪（G1 采样中）' : '等待原生模块就绪…'}
        </Text>
        <ScrollView style={styles.statusScroll}>
          <Text style={styles.statusBody}>
            {ready
              ? `moduleVersion: ${ready.moduleVersion}\n` +
                `osVersion: ${ready.osVersion}\n` +
                `deviceModel: ${ready.deviceModel}\n` +
                `drawingPolicy: ${ready.drawingPolicy}\n` +
                `toolPickerAttached: ${ready.toolPickerAttached}\n` +
                `scrollingEnabled: ${ready.scrollingEnabled}`
              : '若长时间停留在此状态：dev client 未包含 PaintingPencilkit 原生模块，需重新构建（见 runbook 失败判据）。'}
          </Text>
        </ScrollView>
        <View style={styles.buttonRow}>
          <Pressable
            testID={PENCILKIT_PROBE_TEST_IDS.export}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleExport}
            disabled={exportState === 'busy'}
          >
            <Text style={styles.buttonText}>{exportState === 'busy' ? '导出中…' : '导出日志'}</Text>
          </Pressable>
          <Pressable
            testID={PENCILKIT_PROBE_TEST_IDS.clear}
            style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
            onPress={handleClear}
          >
            <Text style={styles.buttonText}>清空</Text>
          </Pressable>
          {exportState === 'error' ? (
            <Text style={styles.errorText}>导出失败，请重试或改用 Xcode Console 取日志</Text>
          ) : null}
        </View>
        <ScrollView testID={PENCILKIT_PROBE_TEST_IDS.strokes} style={styles.strokeList}>
          {strokes.length === 0 ? (
            <Text style={styles.strokeEmpty}>
              尚无完成笔。G1 用例：tap、快速短笔 ×5、快速长笔 ×2、慢速长笔 ×1、变化压力 ×2。
            </Text>
          ) : (
            strokes.map((stroke) => (
              <Text key={stroke.id} style={styles.strokeLine}>
                {formatStrokeLine(stroke)}
              </Text>
            ))
          )}
        </ScrollView>
      </View>
      <PaintingPencilkitView
        testID={PENCILKIT_PROBE_TEST_IDS.canvas}
        style={styles.canvas}
        pencilOnly
        inkColor="#1B6EF3"
        inkWidth={4}
        onReady={handleReady}
        onStroke={handleStroke}
      />
      <View pointerEvents="none" style={styles.hintBar}>
        <Text style={styles.hintText}>
          用 Apple Pencil 在上方区域绘制；手指默认不落墨（pencilOnly）。本页验证 2.1 显示与 G1
          采样，不代表 G2/G3 通过。
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  statusBar: {
    maxHeight: 320,
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D6D8DC',
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#24252A',
  },
  statusScroll: {
    flexGrow: 0,
  },
  statusBody: {
    fontSize: 12,
    fontFamily: 'Menlo',
    color: '#3A3D44',
    lineHeight: 18,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#1B6EF3',
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  errorText: {
    fontSize: 12,
    color: '#C0392B',
  },
  strokeList: {
    flexGrow: 0,
    maxHeight: 120,
  },
  strokeEmpty: {
    fontSize: 12,
    color: '#6B6F76',
    lineHeight: 17,
  },
  strokeLine: {
    fontSize: 11,
    fontFamily: 'Menlo',
    color: '#3A3D44',
    lineHeight: 16,
  },
  canvas: {
    flex: 1,
  },
  hintBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F4F5F7',
  },
  hintText: {
    fontSize: 12,
    color: '#6B6F76',
    lineHeight: 17,
  },
});
