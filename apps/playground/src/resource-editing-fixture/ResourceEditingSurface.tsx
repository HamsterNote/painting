/**
 * ResourceEditingSurface —— 阶段 8 资源/文本编辑验证 UI（仅 Web，经路由动态导入）。
 *
 * 验证对象（全部来自规定子路径，不经根 barrel）：
 *   - `@hamster-note/painting/core`：TextEditSession（begin/update/composition/commit/cancel）、
 *     resourceRegistry（register/resolve）、prepared→index→frame 渲染管线；
 *   - `@hamster-note/painting/skia`：SkiaDrawingCanvas（frame 路径，经路由注入）。
 *
 * 关键不变量：
 *   - draft / composition / measuredHeight 只进 session，绝不写 document、绝不触发 commit；
 *   - 「完成」在 composition 期间仅挂起（requestTextEditCommit），compositionend 时读取
 *     textarea 最终值后明确调用 commitTextEditSession；Enter 只换行，不提交；
 *   - 编辑既有文本期间，canvas 渲染的是移除该条后的 renderDocument（不重复显示）；
 *   - fixture 本地历史只在真实 document 变更（commit / 图片导入）时 push，一次提交一次撤销；
 *   - 图片：浏览器 input/FileReader/Image 解码 → 稳定 resourceId（crypto.randomUUID 或安全
 *     fallback，仅在 app shell 生成）→ registerImageResource → 解码为 SkImage 入 ready map
 *     → document 只写一次 ImageStrokeV2 {resourceId, src}；取消/失败不动 document；
 *   - 传给渲染器的 resolveImage 是同步 resolver：先经 registry 解析（resourceId 优先、src 兜底），
 *     再查 ready map；legacy src-only 样例验证 src 回退；
 *   - 不使用 PixelRatio；canvas 视口恒为 identity（DIP）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { Skia, type SkImage, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import type { SkiaDrawingCanvasProps } from '@hamster-note/painting/skia';
import {
  beginExistingTextEditSession,
  beginNewTextEditSession,
  cancelTextEditSession,
  commitTextEditSession,
  createPreparedDrawingSpatialIndex,
  createResourceRegistry,
  endTextEditComposition,
  prepareDrawingDocument,
  registerImageResource,
  requestTextEditCommit,
  resolveImageResource,
  startTextEditComposition,
  tryCreateDrawingFrame,
  updateTextEditDraft,
  type DrawingValueV2,
  type DrawingStrokeV2,
  type ImageStrokeV2,
  type ResourceRegistry,
  type TextEditSession,
} from '@hamster-note/painting/core';
import {
  FIXTURE_FONT_BASE64,
  FIXTURE_FONT_FAMILY,
  FIXTURE_IMAGE_BASE64,
} from '../skia-fixture/fixtureAssets';

/** 画布固定高度（DIP）；宽度由 onLayout 测量 */
const CANVAS_HEIGHT = 420;
/** 恒等视口（DIP），本 fixture 不验证平移缩放 */
const IDENTITY_VIEWPORT = { scale: 1, tx: 0, ty: 0 } as const;
/** legacy src-only 样例图片的 data URI（复用 skia-fixture 的程序生成 PNG，只读引用） */
const LEGACY_IMAGE_SRC = `data:image/png;base64,${FIXTURE_IMAGE_BASE64}`;

/** 初始 fixture 文档：一条可编辑文本 + 一条 legacy src-only 图片（验证 src 回退） */
const INITIAL_DOCUMENT: DrawingValueV2 = {
  schemaVersion: 2,
  strokes: [
    {
      schemaVersion: 2,
      id: 'fixture-text-seed',
      tool: 'text',
      points: [
        { x: 40, y: 40 },
        { x: 360, y: 120 },
      ],
      text: 'Edit Me 123',
      fontSize: 24,
      strokeColor: '#1A237E',
    },
    {
      schemaVersion: 2,
      id: 'fixture-image-legacy-src',
      tool: 'image',
      points: [
        { x: 400, y: 40 },
        { x: 592, y: 168 },
      ],
      src: LEGACY_IMAGE_SRC,
      strokeColor: '#455A64',
      strokeWidth: 1.5,
    },
  ],
};

interface SkiaResources {
  fontManager: SkTypefaceFontProvider;
  /** 程序生成 PNG 的解码结果（legacy src-only 样例的 ready 像素） */
  legacyImage: SkImage;
}

/** 同步解码内嵌字体与图片；失败抛错由调用方如实展示 */
function decodeResources(): SkiaResources {
  const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBase64(FIXTURE_FONT_BASE64));
  if (!typeface) {
    throw new Error('内嵌字体数据无法解码为 typeface');
  }
  const fontManager = Skia.TypefaceFontProvider.Make();
  fontManager.registerFont(typeface, FIXTURE_FONT_FAMILY);
  const legacyImage = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(FIXTURE_IMAGE_BASE64));
  if (!legacyImage) {
    throw new Error('内嵌 PNG 无法解码为 SkImage');
  }
  return { fontManager, legacyImage };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** FileReader → data URI（Promise 化，失败/取消由调用方处理） */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('FileReader 读取失败'));
    reader.readAsDataURL(file);
  });
}

/** HTMLImageElement 解码以获取真实自然尺寸 */
function decodeHtmlImage(src: string): Promise<{ naturalWidth: number; naturalHeight: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight });
    image.onerror = () => reject(new Error('浏览器无法解码该图片'));
    image.src = src;
  });
}

/** 文本编辑覆盖层的几何（取自 session 目标框；恒等视口下 world=DIP 屏幕坐标） */
interface EditorBox {
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

function editorBoxOf(session: TextEditSession, document: DrawingValueV2): EditorBox {
  if (session.mode === 'new') {
    const target = session.target as { points: readonly { x: number; y: number }[]; fontSize: number };
    const [first, last] = [target.points[0], target.points[target.points.length - 1]];
    return {
      x: Math.min(first.x, last.x),
      y: Math.min(first.y, last.y),
      width: Math.abs(last.x - first.x),
      height: Math.abs(last.y - first.y),
      fontSize: target.fontSize,
    };
  }
  const target = session.target as { index: number };
  const stroke = document.strokes[target.index];
  const points = stroke?.points ?? [];
  const first = points[0] ?? { x: 40, y: 40 };
  const last = points[points.length - 1] ?? { x: first.x + 280, y: first.y + 80 };
  const fontSize = stroke && stroke.tool === 'text' ? stroke.fontSize : 24;
  return {
    x: Math.min(first.x, last.x),
    y: Math.min(first.y, last.y),
    width: Math.max(Math.abs(last.x - first.x), 120),
    height: Math.max(Math.abs(last.y - first.y), 48),
    fontSize,
  };
}

export interface ResourceEditingSurfaceProps {
  /**
   * 路由注入的包级 SkiaDrawingCanvas（CanvasKit 加载时序由路由保证）。
   * Web 开发时可能暂时读取预构建的旧声明，因此在 fixture 边界补充源码已支持的 ready resolver。
   */
  canvasComponent: ComponentType<SkiaDrawingCanvasProps & {
    resolveImage?: (reference: { resourceId?: string; src: string }) => SkImage | null;
  }>;
}

/**
 * core 契约门：本 fixture 依赖的 TextEditSession/resourceRegistry/frame API 必须真实存在。
 * 若包预构建 lib 早于这些 API（web 解析 lib、native 解析 src），如实显示错误卡片，
 * 绝不继续运行缺失函数而崩溃或伪造验证结果。
 */
const CORE_RUNTIME_READY = [
  beginNewTextEditSession,
  beginExistingTextEditSession,
  updateTextEditDraft,
  startTextEditComposition,
  endTextEditComposition,
  requestTextEditCommit,
  commitTextEditSession,
  cancelTextEditSession,
  createResourceRegistry,
  registerImageResource,
  resolveImageResource,
  prepareDrawingDocument,
  createPreparedDrawingSpatialIndex,
  tryCreateDrawingFrame,
].every((fn) => typeof fn === 'function');

export default function ResourceEditingSurface(props: ResourceEditingSurfaceProps) {
  if (!CORE_RUNTIME_READY) {
    return (
      <View style={styles.scrollLike}>
        <View testID="resource-editing-fixture-root" style={styles.card}>
          <Text style={styles.title}>资源/文本编辑 Fixture · 隔离验证入口</Text>
          <Text testID="resource-editing-fixture-core-error" style={styles.coreError}>
            core 契约不满足：缺少 TextEditSession / resourceRegistry / frame API
            （包 lib 预构建产物过旧，需重建 packages/painting 后重试）。未执行任何验证动作。
          </Text>
        </View>
      </View>
    );
  }
  return <ResourceEditingSurfaceInner {...props} />;
}

function ResourceEditingSurfaceInner({ canvasComponent: FixtureCanvas }: ResourceEditingSurfaceProps) {
  // ===== Skia 资源（字体 + legacy 样例图片像素） =====
  const [resources, setResources] = useState<SkiaResources | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  useEffect(() => {
    try {
      setResources(decodeResources());
    } catch (error) {
      setResourceError(errorMessage(error));
    }
  }, []);

  // ===== fixture document / 历史 / 资源表 =====
  const [document, setDocument] = useState<DrawingValueV2>(INITIAL_DOCUMENT);
  const documentRef = useRef(document);
  documentRef.current = document;
  const [history, setHistory] = useState<DrawingValueV2[]>([]);
  const [commitCount, setCommitCount] = useState(0);
  const [registry, setRegistry] = useState<ResourceRegistry>(() => createResourceRegistry());
  const registryRef = useRef(registry);
  registryRef.current = registry;

  /** 解码完成的 SkImage：resourceId → image 与 src → image 双索引（同步 resolver 用） */
  const readyByIdRef = useRef(new Map<string, SkImage>());
  const readyBySrcRef = useRef(new Map<string, SkImage>());
  // legacy src-only 样例的像素在资源就绪后登记
  useEffect(() => {
    if (resources) {
      readyBySrcRef.current.set(LEGACY_IMAGE_SRC, resources.legacyImage);
    }
  }, [resources]);

  /** document 真实变更的唯一入口：push 历史（一次变更一次撤销） */
  const pushDocument = useCallback((next: DrawingValueV2) => {
    setHistory((prev) => [...prev, documentRef.current]);
    setDocument(next);
  }, []);

  // ===== 文本编辑会话（draft 只存 session，绝不写 document） =====
  const [session, setSession] = useState<TextEditSession | null>(null);
  const sessionRef = useRef<TextEditSession | null>(null);
  sessionRef.current = session;
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textSeqRef = useRef(0);
  const [lastCommitNote, setLastCommitNote] = useState('-');

  // 编辑会话建立后聚焦 textarea（编辑层的唯一焦点入口）
  useEffect(() => {
    if (session) {
      textareaRef.current?.focus();
    }
  }, [session]);

  /** 消费一次提交：document 变更才计 commit；空新文本/cancel 不产生任何 document 变化 */
  const finalizeCommit = useCallback(
    (target: TextEditSession) => {
      const result = commitTextEditSession(documentRef.current, target);
      if (result.document !== documentRef.current) {
        pushDocument(result.document);
        setCommitCount((prev) => prev + 1);
        setLastCommitNote(
          result.session.mode === 'new'
            ? `已提交新文本（${result.session.draft.text.length} 字）`
            : result.session.draft.text.length === 0
              ? '已提交删除（文本清空）'
              : '已提交文本修改'
        );
      } else {
        setLastCommitNote(
          result.diagnostics.length > 0
            ? `未写入（${result.diagnostics.map((d) => d.type).join(', ')}）`
            : '未写入（空内容）'
        );
      }
      setSession(null);
    },
    [pushDocument]
  );

  const handleCreateText = useCallback(() => {
    const seq = ++textSeqRef.current;
    const offsetX = (seq % 3) * 24;
    const offsetY = (seq % 4) * 28;
    const next = beginNewTextEditSession(
      {
        id: `fixture-text-${seq}`,
        points: [
          { x: 60 + offsetX, y: 180 + offsetY },
          { x: 340 + offsetX, y: 260 + offsetY },
        ],
        fontSize: 22,
      },
      { text: '' }
    );
    setSession(next);
    setLastCommitNote('-');
  }, []);

  const handleEditText = useCallback((index: number, stroke: DrawingStrokeV2) => {
    if (stroke.tool !== 'text') {
      return;
    }
    setSession(
      beginExistingTextEditSession(
        { index, expectedStrokeId: stroke.id, expectedTool: 'text' },
        { text: stroke.text, fontSize: stroke.fontSize, points: stroke.points }
      )
    );
    setLastCommitNote('-');
  }, []);

  // textarea 事件：composition 期间完成仅挂起；Enter 默认换行（不拦截、不提交）
  const handleTextareaInput = useCallback(() => {
    const textarea = textareaRef.current;
    const current = sessionRef.current;
    if (!textarea || !current) {
      return;
    }
    // measuredHeight 也仅记录在 draft，不进 document
    setSession(updateTextEditDraft(current, { text: textarea.value, measuredHeight: textarea.scrollHeight }));
  }, []);

  const handleCompositionStart = useCallback(() => {
    const current = sessionRef.current;
    if (current) {
      setSession(startTextEditComposition(current));
    }
  }, []);

  const handleCompositionEnd = useCallback(() => {
    const textarea = textareaRef.current;
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    // compositionend：先读取 textarea 最终值，再结束 composition
    let next = updateTextEditDraft(current, {
      text: textarea ? textarea.value : current.draft.text,
    });
    next = endTextEditComposition(next);
    if (next.commitRequested) {
      // composition 期间挂起的提交，此刻明确消费
      finalizeCommit(next);
    } else {
      setSession(next);
    }
  }, [finalizeCommit]);

  const handleDone = useCallback(() => {
    const textarea = textareaRef.current;
    const current = sessionRef.current;
    if (!current) {
      return;
    }
    let next = updateTextEditDraft(current, {
      text: textarea ? textarea.value : current.draft.text,
      ...(textarea ? { measuredHeight: textarea.scrollHeight } : {}),
    });
    next = requestTextEditCommit(next);
    if (next.isComposing) {
      // composition 期间完成：仅挂起，compositionend 时再提交
      setSession(next);
    } else {
      finalizeCommit(next);
    }
  }, [finalizeCommit]);

  const handleCancel = useCallback(() => {
    const current = sessionRef.current;
    if (current) {
      // cancel 不接触 document
      setSession(cancelTextEditSession(current));
    }
    setSession(null);
    setLastCommitNote('已取消（document 未变）');
  }, []);

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) {
        return prev;
      }
      const next = [...prev];
      const restored = next.pop()!;
      setDocument(restored);
      return next;
    });
    setLastCommitNote('已撤销一步');
  }, []);

  // ===== 图片导入（app shell 职责：FileReader/Image/resourceId/Skia 解码） =====
  const [imageImportStatus, setImageImportStatus] = useState('等待选择图片');
  const imageSeqRef = useRef(0);

  const handleImageFile = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      // 允许重复选择同一文件再次触发 change
      input.value = '';
      if (!file) {
        // 取消选择：document/registry 均不变
        setImageImportStatus('已取消（document 未变）');
        return;
      }
      setImageImportStatus('读取并解码中…');
      void (async () => {
        try {
          const dataUrl = await readFileAsDataURL(file);
          const { naturalWidth, naturalHeight } = await decodeHtmlImage(dataUrl);
          const skImage = Skia.Image.MakeImageFromEncoded(
            Skia.Data.fromBase64(dataUrl.slice(dataUrl.indexOf(',') + 1))
          );
          if (!skImage) {
            throw new Error('Skia 无法解码该图片');
          }
          // 稳定资源 ID 只在这里（app shell）生成；core 不生成 ID
          const resourceId =
            typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
              ? crypto.randomUUID()
              : `fixture-resource-${Date.now()}-${++imageSeqRef.current}`;
          const registered = registerImageResource(registryRef.current, {
            resourceId,
            src: dataUrl,
            naturalWidth,
            naturalHeight,
          });
          if (registered.diagnostics.length > 0) {
            throw new Error('资源登记冲突');
          }
          setRegistry(registered.registry);
          readyByIdRef.current.set(resourceId, skImage);
          readyBySrcRef.current.set(dataUrl, skImage);
          // 成功路径：document 只写一次 ImageStrokeV2 {resourceId, src, ...}
          const width = Math.min(180, naturalWidth);
          const height = (width * naturalHeight) / naturalWidth;
          const stroke: ImageStrokeV2 = {
            schemaVersion: 2,
            id: `fixture-image-${++imageSeqRef.current}`,
            tool: 'image',
            resourceId,
            src: dataUrl,
            points: [
              { x: 400, y: 200 },
              { x: 400 + width, y: 200 + height },
            ],
            strokeColor: '#455A64',
            strokeWidth: 1.5,
          };
          pushDocument({ schemaVersion: 2, strokes: [...documentRef.current.strokes, stroke] });
          setImageImportStatus(`已导入 ${resourceId.slice(0, 8)}…（${naturalWidth}×${naturalHeight}）`);
        } catch (error) {
          // 失败：document/registry 均不变
          setImageImportStatus(`失败：${errorMessage(error)}（document 未变）`);
        }
      })();
    },
    [pushDocument]
  );

  // ===== 渲染文档：编辑既有文本期间隐藏该条，避免与 textarea 重复显示 =====
  const renderDocument = useMemo(() => {
    if (!session || session.mode !== 'existing') {
      return document;
    }
    const target = session.target as { index: number };
    const filtered: DrawingValueV2 = {
      schemaVersion: 2,
      strokes: document.strokes.filter((_, index) => index !== target.index),
    };
    return filtered;
  }, [document, session]);

  // ===== prepared → index → frame（恒等视口，canvas 尺寸为 DIP） =====
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);
  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setCanvasSize({ width, height });
    }
  }, []);

  const frameOutcome = useMemo(() => {
    if (!canvasSize) {
      return null;
    }
    try {
      const prepared = prepareDrawingDocument(renderDocument);
      const spatialIndex = createPreparedDrawingSpatialIndex(prepared);
      return tryCreateDrawingFrame({
        prepared,
        spatialIndex,
        viewport: IDENTITY_VIEWPORT,
        layoutSize: canvasSize,
      });
    } catch {
      return null;
    }
  }, [renderDocument, canvasSize]);
  const frame = frameOutcome?.ok ? frameOutcome.frame : null;

  /** 同步图片 resolver：将完整 stroke reference 交给 registry，再查询 ready map。 */
  const resolveImage = useCallback(
    (reference: { resourceId?: string; src: string }): SkImage | null => {
      const resolved = resolveImageResource(registryRef.current, reference).resource;
      if (resolved) {
        const byId = readyByIdRef.current.get(resolved.resourceId);
        if (byId) {
          return byId;
        }
      }
      return readyBySrcRef.current.get(reference.src) ?? null;
    },
    []
  );

  const ready = resources !== null && frame !== null;
  const editorBox = session ? editorBoxOf(session, document) : null;

  const statusText = session
    ? `会话：编辑中（${session.mode === 'new' ? '新建' : '既有'} · composing=${session.isComposing ? '是' : '否'} · 待提交=${session.commitRequested ? '是' : '否'} · 草稿 ${session.draft.text.length} 字 · measuredHeight=${session.draft.measuredHeight ?? '-'} DIP）`
    : '会话：无';
  const textStrokes = document.strokes.filter((stroke) => stroke.tool === 'text');
  const imageStrokes = document.strokes.filter((stroke) => stroke.tool === 'image');

  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <View testID="resource-editing-fixture-root" style={styles.card}>
        {/* 头部：隔离入口与验证范围声明（不声称 8.1/8.2/8.5 完成） */}
        <View style={styles.header}>
          <Text style={styles.title}>资源/文本编辑 Fixture · 隔离验证入口</Text>
          <Text style={styles.note}>
            本页验证范围（Web）：TextEditSession 的 composition/提交/取消、单会话历史撤销、
            图片资源注册与 Skia 渲染（resourceId 优先、src 回退）。原生 IME 与平台图片选择器
            仍需真机验证；本页不代表任务 8.1/8.2/8.5 已完成。
          </Text>
          <Text style={styles.note}>
            注意：画布内嵌字体仅含 ASCII 子集，非 ASCII 字符在画布上可能显示为字体回退字形
            （textarea 编辑层不受此限）。
          </Text>
        </View>

        {/* 状态与计数（E2E 可断言） */}
        <View style={styles.statusPanel}>
          <Text testID="resource-editing-fixture-status" style={styles.statusText}>
            {statusText}
          </Text>
          <View style={styles.counterRow}>
            <Text style={styles.counterItem}>
              提交数 <Text testID="resource-editing-fixture-commit-count" style={styles.counterValue}>{commitCount}</Text>
            </Text>
            <Text style={styles.counterItem}>
              历史深度 <Text testID="resource-editing-fixture-history-count" style={styles.counterValue}>{history.length}</Text>
            </Text>
            <Text style={styles.counterItem}>
              资源数 <Text testID="resource-editing-fixture-resource-count" style={styles.counterValue}>{registry.records.length}</Text>
            </Text>
            <Text style={styles.counterItem}>
              笔迹数 <Text testID="resource-editing-fixture-stroke-count" style={styles.counterValue}>{document.strokes.length}</Text>
            </Text>
          </View>
          <Text style={styles.note}>最近提交：{lastCommitNote}</Text>
        </View>

        {/* 工具行：新建文本 / 撤销 */}
        <View style={styles.buttonRow}>
          <Pressable
            testID="resource-editing-fixture-text-create"
            onPress={handleCreateText}
            disabled={session !== null}
            accessibilityRole="button"
            accessibilityLabel="新建文本"
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || session !== null) && styles.buttonDimmed,
            ]}
          >
            <Text style={styles.primaryButtonText}>新建文本</Text>
          </Pressable>
          <Pressable
            testID="resource-editing-fixture-text-undo"
            onPress={handleUndo}
            disabled={history.length === 0}
            accessibilityRole="button"
            accessibilityLabel="撤销一步"
            style={({ pressed }) => [
              styles.secondaryButton,
              (pressed || history.length === 0) && styles.buttonDimmed,
            ]}
          >
            <Text style={styles.secondaryButtonText}>撤销一步</Text>
          </Pressable>
        </View>

        {/* 画布 + 文本编辑覆盖层（恒等视口，world=DIP 屏幕坐标） */}
        <View style={styles.canvasWrap} onLayout={handleCanvasLayout}>
          {ready && resources && frame ? (
            <View testID="resource-editing-fixture-canvas" style={canvasSize}>
              <FixtureCanvas
                frame={frame}
                fontManager={resources.fontManager}
                fontFamily={FIXTURE_FONT_FAMILY}
                resolveImage={resolveImage}
                canvasProps={{ style: canvasSize }}
              />
            </View>
          ) : (
            <View style={styles.canvasPlaceholder}>
              <Text style={styles.placeholderText}>
                {resourceError ? `资源解码失败：${resourceError}` : '资源准备中…'}
              </Text>
            </View>
          )}

          {/* 绝对定位 Web textarea 临时编辑层（非 SVG foreignObject） */}
          {session && editorBox ? (
            <textarea
              ref={textareaRef}
              data-testid="resource-editing-fixture-text-editor"
              defaultValue={session.draft.text}
              onInput={handleTextareaInput}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={handleCompositionEnd}
              style={{
                position: 'absolute',
                left: editorBox.x,
                top: editorBox.y,
                width: editorBox.width,
                height: editorBox.height,
                fontSize: editorBox.fontSize,
                lineHeight: 1.25,
                padding: 4,
                border: '2px solid #3B5BDB',
                borderRadius: 6,
                background: '#FFFFFF',
                color: '#1A237E',
                resize: 'none',
                outline: 'none',
                zIndex: 2,
              }}
            />
          ) : null}
        </View>

        {/* 编辑动作：完成/取消（仅编辑中可见） */}
        {session ? (
          <View style={styles.buttonRow}>
            <Pressable
              testID="resource-editing-fixture-text-done"
              onPress={handleDone}
              accessibilityRole="button"
              accessibilityLabel="完成编辑"
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonDimmed]}
            >
              <Text style={styles.primaryButtonText}>
                完成{session.isComposing ? '（composition 中，将挂起）' : ''}
              </Text>
            </Pressable>
            <Pressable
              testID="resource-editing-fixture-text-cancel"
              onPress={handleCancel}
              accessibilityRole="button"
              accessibilityLabel="取消编辑"
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonDimmed]}
            >
              <Text style={styles.secondaryButtonText}>取消（不写 document）</Text>
            </Pressable>
          </View>
        ) : null}

        {/* 图片导入 */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>图片导入（FileReader → resourceId → registry → SkImage）</Text>
          <View style={styles.buttonRow}>
            <input
              type="file"
              accept="image/*"
              data-testid="resource-editing-fixture-image-input"
              onChange={handleImageFile}
              style={{ fontSize: 13 }}
            />
          </View>
          <Text testID="resource-editing-fixture-image-import-status" style={styles.note}>
            {imageImportStatus}
          </Text>
        </View>

        {/* 已提交内容清单（可定位的 committed 标识） */}
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>已提交内容（document 真源）</Text>
          {textStrokes.map((stroke) => {
            const index = document.strokes.indexOf(stroke);
            const editing = session?.mode === 'existing' && (session.target as { index: number }).index === index;
            return (
              <View key={stroke.id} style={styles.committedRow}>
                <Text
                  testID={`resource-editing-fixture-committed-text-${stroke.id}`}
                  // 非视觉的可访问文本标记：携带精确的已提交文本，供 E2E 断言“精确恢复”，
                  // 不改变任何布局/样式（屏幕阅读器读到的也就是 commit 后的真源文本）。
                  accessibilityLabel={(stroke as { text: string }).text}
                  style={styles.committedText}
                >
                  文本 {stroke.id}（{(stroke as { text: string }).text.length} 字）
                </Text>
                <Pressable
                  testID={`resource-editing-fixture-text-edit-${stroke.id}`}
                  onPress={() => handleEditText(index, stroke)}
                  disabled={session !== null}
                  accessibilityRole="button"
                  accessibilityLabel={`编辑文本 ${stroke.id}`}
                  style={({ pressed }) => [
                    styles.smallButton,
                    (pressed || session !== null) && styles.buttonDimmed,
                  ]}
                >
                  <Text style={styles.smallButtonText}>{editing ? '编辑中' : '编辑'}</Text>
                </Pressable>
              </View>
            );
          })}
          {imageStrokes.map((stroke) => {
            const image = stroke as ImageStrokeV2;
            return (
              <Text
                key={stroke.id}
                testID={`resource-editing-fixture-committed-image-${stroke.id}`}
                style={styles.committedText}
              >
                图片 {stroke.id}（{image.resourceId ? `resourceId ${image.resourceId.slice(0, 8)}…` : '仅 src（legacy 回退）'}）
              </Text>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

/** 视觉与既有 fixture 一致：暖纸白页面、白卡片、细边框、墨色强调 */
const styles = StyleSheet.create({
  // core 契约不满足时的外层容器（与 scroll 保持一致的页面底色与留白）
  scrollLike: {
    flex: 1,
    padding: 16,
    backgroundColor: '#F5F3EE',
  },
  coreError: {
    fontSize: 13,
    color: '#C0392B',
    lineHeight: 19,
  },
  scroll: {
    padding: 16,
    backgroundColor: '#F5F3EE',
  },
  card: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#E6E2D8',
    borderWidth: 1,
    borderRadius: 14,
    padding: 16,
    gap: 12,
  },
  header: {
    gap: 4,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#24252A',
  },
  note: {
    fontSize: 12,
    color: '#6B6F76',
    lineHeight: 17,
  },
  statusPanel: {
    borderWidth: 1,
    borderColor: '#E6E2D8',
    borderRadius: 10,
    padding: 12,
    gap: 6,
    backgroundColor: '#FBFAF6',
  },
  statusText: {
    fontSize: 13,
    color: '#3A3C41',
    fontVariant: ['tabular-nums'],
  },
  counterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  counterItem: {
    fontSize: 12,
    color: '#6B6F76',
  },
  counterValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3B5BDB',
    fontVariant: ['tabular-nums'],
  },
  buttonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  primaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#3B5BDB',
  },
  primaryButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D8D4C8',
    backgroundColor: '#FFFFFF',
  },
  secondaryButtonText: {
    fontSize: 13,
    color: '#3A3C41',
  },
  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#D8D4C8',
    backgroundColor: '#FFFFFF',
  },
  smallButtonText: {
    fontSize: 12,
    color: '#3A3C41',
  },
  buttonDimmed: {
    opacity: 0.6,
  },
  canvasWrap: {
    width: '100%',
    height: CANVAS_HEIGHT,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E6E2D8',
    backgroundColor: '#FBFAF6',
    overflow: 'hidden',
    position: 'relative',
  },
  canvasPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    fontSize: 13,
    color: '#9A9EA6',
  },
  panel: {
    borderWidth: 1,
    borderColor: '#E6E2D8',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3A3C41',
  },
  committedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  committedText: {
    fontSize: 12,
    color: '#3A3C41',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
});
