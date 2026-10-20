import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  PaintingPencilkitView,
  type PaintingPencilkitReadyEvent,
} from '@hamster-note/painting-pencilkit';

/** 对外暴露的稳定 testID 集合，供真机验收与后续自动化引用 */
export const PENCILKIT_PROBE_TEST_IDS = {
  root: 'pencilkit-probe-root',
  canvas: 'pencilkit-probe-canvas',
  status: 'pencilkit-probe-status',
} as const;

/**
 * iOS `/pencilkit-probe` 路由实现（tasks 2.1 的 RN host 原型）。
 *
 * 验收点（见 docs/implementation/ios-pencilkit-surface/）：
 *   - Expo Module 经 autolinking 进入 dev client，原生 view 上屏；
 *   - onReady 回传 moduleVersion / osVersion / drawingPolicy 等配置事实；
 *   - Apple Pencil 可在下方区域绘制（PKInkingTool 预览），手指默认不落墨
 *     （pencilOnly）；本期不含采样、分流与交接（G1–G3 门槛增量）。
 *
 * 本文件只在 iOS bundle 中被 Metro 选用；Web/Android 由同目录基名文件
 * 提供说明页，不导入 @hamster-note/painting-pencilkit。
 */
export default function PencilkitProbeRoute() {
  const [ready, setReady] = useState<PaintingPencilkitReadyEvent | null>(null);

  const handleReady = useCallback((event: { nativeEvent: PaintingPencilkitReadyEvent }) => {
    setReady(event.nativeEvent);
  }, []);

  return (
    <View testID={PENCILKIT_PROBE_TEST_IDS.root} style={styles.container}>
      <View style={styles.statusBar}>
        <Text testID={PENCILKIT_PROBE_TEST_IDS.status} style={styles.statusTitle}>
          {ready ? '原生模块已就绪' : '等待原生模块就绪…'}
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
      </View>
      <PaintingPencilkitView
        testID={PENCILKIT_PROBE_TEST_IDS.canvas}
        style={styles.canvas}
        pencilOnly
        inkColor="#1B6EF3"
        inkWidth={4}
        onReady={handleReady}
      />
      <View pointerEvents="none" style={styles.hintBar}>
        <Text style={styles.hintText}>
          用 Apple Pencil 在上方区域绘制；手指默认不落墨（pencilOnly）。本页仅验证 2.1
          显示与配置，不代表 G1–G3 通过。
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
    maxHeight: 180,
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
