import { useEffect, useMemo, useRef, useState } from 'react';
import { Skia, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { WebShapedRunProvider } from '@hamster-note/painting/skia';
import type { FrameTextProgram, FrameTextRequest } from '@hamster-note/painting/core';
import type { CandidateLifecycleDiagnostics } from './CandidateLifecycleDiagnostics.web';

const SHAPING_TIMEOUT_MS = 5_000;
const INITIAL_ASSET_ID = 'latin';
/** 非 ready 文本的 render/hit 终止程序；语义与 core frameClipping 的 empty-text 完全一致。 */
const EMPTY_TEXT_PROGRAM: FrameTextProgram = Object.freeze({ kind: 'empty-text' });
const TIER_ASSET_IDS = {
  cjk: 'cjk-on-demand',
  arabic: 'arabic-on-demand',
  emoji: 'emoji-on-demand',
} as const;

type RequiredTier = keyof typeof TIER_ASSET_IDS;
type FontManifestAsset = Readonly<{
  id: string;
  tier: 'initial' | 'on-demand';
  url: string;
  family: string;
}>;
type FontManifest = Readonly<{ schemaVersion: number; assets: readonly FontManifestAsset[] }>;
type GlyphReadableTypeface = Readonly<{
  getGlyphIDs?: (text: string, numCodePoints?: number) => ArrayLike<number>;
}>;
type DisposableHostObject = Readonly<{ dispose?: () => void; delete?: () => void }>;
type TextDemand = Readonly<{
  tiers: ReadonlySet<RequiredTier>;
  charactersByTier: ReadonlyMap<RequiredTier | 'latin', string>;
  unsupported: readonly string[];
}>;

export type CandidateTextResourceState = Readonly<{
  phase: 'pending' | 'ready' | 'error';
  message: string | null;
}>;

export type CandidateFontAssets = Readonly<{
  phase: 'pending' | 'ready';
  /** Only published owners receive a revision. A loading effect never impersonates a provider. */
  resourceRevision: number;
  providerIdentity: string;
  summary: string;
  fontManager: SkTypefaceFontProvider | null;
  fontFamilies: readonly string[];
  rendererFontFamily: string | null;
  shapingProvider: WebShapedRunProvider | null;
  requestState: (request: FrameTextRequest) => CandidateTextResourceState;
}>;

export type CandidateTextShaping = Readonly<{
  phase: 'pending' | 'ready' | 'error';
  programRevision: string;
  pending: number;
  ready: number;
  error: number;
  message: string | null;
  entries: readonly CandidateTextResourceState[];
  resolveTextProgram: (request: FrameTextRequest) => FrameTextProgram | null;
}>;

type ShapingRecord = Readonly<{
  phase: 'pending' | 'ready' | 'error';
  cursor: number;
  message?: string;
}>;
type LoadedFont = Readonly<{ asset: FontManifestAsset; typeface: unknown }>;
type FontOwner = Readonly<{
  resourceRevision: number;
  providerIdentity: string;
  fontManager: SkTypefaceFontProvider | null;
  fontFamilies: readonly string[];
  shapingProvider: WebShapedRunProvider | null;
  tierErrors: ReadonlyMap<RequiredTier | 'latin', string>;
  fontsByTier: ReadonlyMap<RequiredTier | 'latin', LoadedFont>;
  manifestError: string | null;
  summary: string;
}>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function disposeHostObject(value: unknown): void {
  const disposable = value as DisposableHostObject | null;
  if (typeof disposable?.dispose === 'function') disposable.dispose();
  else if (typeof disposable?.delete === 'function') disposable.delete();
}

function disposeUnpublishedOwner(
  owner: Omit<FontOwner, 'resourceRevision' | 'providerIdentity'>
): void {
  // A superseded build has never reached a Frame, so all of its CanvasKit objects are safe to release.
  for (const { typeface } of owner.fontsByTier.values()) disposeHostObject(typeface);
  disposeHostObject(owner.fontManager);
}

function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function isLatinCoverage(codePoint: number): boolean {
  return (
    (codePoint >= 0x0000 && codePoint <= 0x00ff) ||
    (codePoint >= 0x0100 && codePoint <= 0x024f) ||
    codePoint === 0x0259 ||
    (codePoint >= 0x1e00 && codePoint <= 0x1eff) ||
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    codePoint === 0x20ac ||
    codePoint === 0x2122
  );
}

/**
 * Paragraph 必须接收完整原串以保留换行、双向控制与 emoji 序列语义；但这些布局控制/格式码点
 * 通常没有独立可绘 glyph，不能参与 Typeface 的非零 glyph 覆盖校验。
 */
function isLayoutControlOrFormatCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x0000 && codePoint <= 0x001f) ||
    (codePoint >= 0x007f && codePoint <= 0x009f) ||
    codePoint === 0x00ad ||
    codePoint === 0x034f ||
    codePoint === 0x061c ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029 ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2060 && codePoint <= 0x206f) ||
    codePoint === 0xfeff ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)
  );
}

/** CJK tier 负责所有表意文字；subset 漏字必须在实际 Typeface glyph 校验时作为 entry error 暴露。 */
function isCjkIdeograph(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0x20000 && codePoint <= 0x2ebef) ||
    (codePoint >= 0x2f800 && codePoint <= 0x2fa1f) ||
    (codePoint >= 0x30000 && codePoint <= 0x323af)
  );
}

/** Production subset 外的字符必须明确失败，绝不把浏览器 fallback 当作 Skia 成功。 */
function inspectTextDemand(texts: readonly string[]): TextDemand {
  const tiers = new Set<RequiredTier>();
  const characters = new Map<RequiredTier | 'latin', Set<string>>();
  const unsupported = new Set<string>();
  const add = (tier: RequiredTier | 'latin', character: string) => {
    const bucket = characters.get(tier) ?? new Set<string>();
    bucket.add(character);
    characters.set(tier, bucket);
  };

  for (const text of texts) {
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) continue;
      // 保留原始 text 给 Paragraph；这里只排除没有独立绘制义务的码点，绝不截断、规范化或重排。
      if (isLayoutControlOrFormatCodePoint(codePoint)) {
        continue;
      }
      if (isCjkIdeograph(codePoint)) {
        tiers.add('cjk');
        add('cjk', character);
      } else if (codePoint >= 0x0600 && codePoint <= 0x08ff) {
        tiers.add('arabic');
        add('arabic', character);
      } else if (codePoint >= 0x1f000 && codePoint <= 0x1faff) {
        tiers.add('emoji');
        add('emoji', character);
      } else if (isLatinCoverage(codePoint)) {
        add('latin', character);
      } else {
        unsupported.add(codePointLabel(codePoint));
      }
    }
  }

  return {
    tiers,
    charactersByTier: new Map(
      [...characters.entries()].map(([tier, values]) => [tier, [...values].join('')])
    ),
    unsupported: [...unsupported],
  };
}

function manifestAsset(manifest: FontManifest, id: string): FontManifestAsset {
  const asset = manifest.assets.find((candidate) => candidate.id === id);
  if (!asset || !asset.url.startsWith('/fonts/') || !asset.family) {
    throw new Error(`字体 manifest 缺少或损坏资源「${id}」`);
  }
  return asset;
}

function verifyGlyphCoverage(
  typeface: unknown,
  characters: string,
  asset: FontManifestAsset
): void {
  if (!characters) return;
  const reader = typeface as GlyphReadableTypeface;
  if (typeof reader.getGlyphIDs !== 'function') {
    throw new Error(`字体「${asset.id}」无法验证目标 glyph`);
  }
  const glyphs = reader.getGlyphIDs(characters, [...characters].length);
  if (Array.from(glyphs).some((glyph) => glyph === 0)) {
    throw new Error(`字体「${asset.id}」缺少当前文本所需 glyph`);
  }
}

async function fetchFont(
  url: string,
  cache: RequestCache,
  signal: AbortSignal
): Promise<Uint8Array> {
  const response = await fetch(url, { cache, signal });
  if (!response.ok) throw new Error(`请求 ${url} 失败（HTTP ${response.status}）`);
  return new Uint8Array(await response.arrayBuffer());
}

function requestStateFor(
  demand: TextDemand,
  phase: CandidateFontAssets['phase'],
  owner: FontOwner | null,
  loadingTiers: ReadonlySet<RequiredTier | 'latin'>
): CandidateTextResourceState {
  if (demand.unsupported.length > 0) {
    return {
      phase: 'error',
      message: `当前生产字体资产不支持字符：${demand.unsupported.join('、')}`,
    };
  }
  if (phase === 'pending' || owner === null) return { phase: 'pending', message: null };
  const requiredTiers = [
    ...(demand.charactersByTier.has('latin') ? (['latin'] as const) : []),
    ...demand.tiers,
  ];
  for (const tier of requiredTiers) {
    if (loadingTiers.has(tier)) return { phase: 'pending', message: null };
    const message = owner.tierErrors.get(tier);
    if (message) return { phase: 'error', message };
    const font = owner.fontsByTier.get(tier);
    if (!font) return { phase: 'error', message: `字体「${tier}」未就绪` };
    try {
      // 当前文本才决定 glyph 覆盖，不能因同 tier 的另一条文本失败而整 tier 失败。
      verifyGlyphCoverage(font.typeface, demand.charactersByTier.get(tier) ?? '', font.asset);
    } catch (error) {
      return { phase: 'error', message: errorMessage(error) };
    }
  }
  if (!owner.shapingProvider)
    return { phase: 'error', message: '没有可用于当前文本的生产字体 provider' };
  return { phase: 'ready', message: null };
}

function makeAssetsState(
  owner: FontOwner | null,
  loadingTiers: ReadonlySet<RequiredTier | 'latin'>
): CandidateFontAssets {
  const phase = owner ? 'ready' : 'pending';
  return {
    phase,
    resourceRevision: owner?.resourceRevision ?? 0,
    providerIdentity: owner?.providerIdentity ?? 'none',
    summary: owner?.summary ?? '正在读取生产字体 manifest…',
    fontManager: owner?.fontManager ?? null,
    fontFamilies: owner?.fontFamilies ?? [],
    rendererFontFamily: owner?.fontFamilies[0] ?? null,
    shapingProvider: owner?.shapingProvider ?? null,
    requestState: (request) =>
      requestStateFor(inspectTextDemand([request.text]), phase, owner, loadingTiers),
  };
}

/**
 * 仅在 route 已完成 LoadSkiaWeb 后调用。每个已发布 owner 独占 FontManager、provider、Typeface
 * 与 provider cache。已发布 owner 的 Typeface 可能被已提交 Paragraph 间接引用，因此只在 route
 * unmount 后释放；取消或被 supersede、且从未发布的 generation 会立即释放其 HostObject。
 */
export function useCandidateFontAssets(
  texts: readonly string[],
  retryGeneration: number,
  diagnostics?: CandidateLifecycleDiagnostics
): CandidateFontAssets {
  const textKey = texts.join('\u0000');
  const requiredTierSignature = useMemo(
    () => [...inspectTextDemand(textKey.split('\u0000')).tiers].sort().join(','),
    [textKey]
  );
  const [state, setState] = useState<CandidateFontAssets>(() => makeAssetsState(null, new Set()));
  const generationRef = useRef(0);
  const resourceRevisionRef = useRef(0);
  const manifestRef = useRef<FontManifest | null>(null);
  const fontBytesRef = useRef(new Map<string, Uint8Array>());
  const failedAssetIdsRef = useRef(new Set<string>());
  const publishedOwnerRef = useRef<FontOwner | null>(null);
  const publishedOwnersRef = useRef<FontOwner[]>([]);

  useEffect(() => {
    const publishedOwners = publishedOwnersRef.current;
    return () => {
      // This effect has no dependency and runs only at route teardown in production. Every published
      // owner is retained until then because a Paragraph can retain its raw Typeface beyond a frame.
      const owners = publishedOwners.splice(0);
      for (const owner of owners) disposeUnpublishedOwner(owner);
    };
  }, []);

  useEffect(() => {
    const tiers = requiredTierSignature
      ? requiredTierSignature
          .split(',')
          .filter((tier): tier is RequiredTier => tier in TIER_ASSET_IDS)
      : [];
    const generation = ++generationRef.current;
    const abort = new AbortController();
    let cancelled = false;
    let published = false;
    diagnostics?.increment('font-effects-created');
    const isCurrent = () => !cancelled && generation === generationRef.current;
    const requiredTiers: readonly (RequiredTier | 'latin')[] = ['latin', ...tiers];
    const currentOwner = publishedOwnerRef.current;
    const loadingTiers = new Set<RequiredTier | 'latin'>(
      requiredTiers.filter((tier) => !currentOwner?.fontsByTier.has(tier))
    );

    // Keep the last published provider intact while a required on-demand tier is loading. Its request
    // state marks only the new tier pending, so old provider caches cannot be read as a new generation.
    setState(makeAssetsState(currentOwner, loadingTiers));

    void (async () => {
      let manifest: FontManifest;
      try {
        if (!manifestRef.current) {
          const response = await fetch('/fonts/manifest.json', {
            cache: retryGeneration > 0 ? 'reload' : 'no-cache',
            signal: abort.signal,
          });
          if (!response.ok) {
            throw new Error(`请求 /fonts/manifest.json 失败（HTTP ${response.status}）`);
          }
          const loaded = (await response.json()) as FontManifest;
          if (loaded.schemaVersion !== 1 || !Array.isArray(loaded.assets)) {
            throw new Error('字体 manifest schema 不受支持');
          }
          if (!isCurrent()) return;
          manifestRef.current = loaded;
        }
        manifest = manifestRef.current;
      } catch (error) {
        if (!isCurrent()) return;
        const owner: FontOwner = {
          resourceRevision: ++resourceRevisionRef.current,
          providerIdentity: `provider-${resourceRevisionRef.current}-none`,
          fontManager: null,
          fontFamilies: [],
          shapingProvider: null,
          tierErrors: new Map(),
          fontsByTier: new Map(),
          manifestError: errorMessage(error),
          summary: '生产字体 manifest 不可用',
        };
        publishedOwnerRef.current = owner;
        publishedOwnersRef.current.push(owner);
        published = true;
        diagnostics?.increment('font-effects-published');
        setState(makeAssetsState(owner, new Set()));
        return;
      }

      const tierErrors = new Map<RequiredTier | 'latin', string>();
      const fontsByTier = new Map<RequiredTier | 'latin', LoadedFont>();
      const usable: LoadedFont[] = [];
      const required = [
        ['latin', INITIAL_ASSET_ID] as const,
        ...tiers.map((tier) => [tier, TIER_ASSET_IDS[tier]] as const),
      ];
      let fontManager: SkTypefaceFontProvider | null = null;
      let shapingProvider: WebShapedRunProvider | null = null;
      const fontFamilies: string[] = [];
      const unpublished = () => ({
        fontManager,
        fontFamilies,
        shapingProvider,
        tierErrors,
        fontsByTier,
        manifestError: null,
        summary: '',
      });

      try {
        for (const [tier, assetId] of required) {
          if (!isCurrent()) {
            disposeUnpublishedOwner(unpublished());
            return;
          }
          try {
            const asset = manifestAsset(manifest, assetId);
            const reloadFailedAsset =
              retryGeneration > 0 && failedAssetIdsRef.current.has(asset.id);
            let bytes = fontBytesRef.current.get(asset.id);
            if (!bytes || reloadFailedAsset) {
              bytes = await fetchFont(
                asset.url,
                reloadFailedAsset ? 'reload' : 'force-cache',
                abort.signal
              );
              if (!isCurrent()) {
                disposeUnpublishedOwner(unpublished());
                return;
              }
              fontBytesRef.current.set(asset.id, bytes);
            }
            if (!isCurrent()) {
              disposeUnpublishedOwner(unpublished());
              return;
            }
            const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(Skia.Data.fromBytes(bytes));
            if (!typeface) throw new Error(`字体「${asset.id}」无法由 Skia 解码`);
            if (!isCurrent()) {
              disposeHostObject(typeface);
              // Earlier tier Typeface instances belong to the same unpublished build as this one.
              disposeUnpublishedOwner(unpublished());
              return;
            }
            const loaded = { asset, typeface };
            usable.push(loaded);
            fontsByTier.set(tier, loaded);
            failedAssetIdsRef.current.delete(asset.id);
          } catch (error) {
            if (!isCurrent()) {
              disposeUnpublishedOwner(unpublished());
              return;
            }
            failedAssetIdsRef.current.add(assetId);
            tierErrors.set(tier, errorMessage(error));
          }
        }

        if (usable.length > 0) {
          if (!isCurrent()) {
            disposeUnpublishedOwner(unpublished());
            return;
          }
          fontManager = Skia.TypefaceFontProvider.Make();
          if (!isCurrent()) {
            disposeUnpublishedOwner(unpublished());
            return;
          }
          for (const { asset, typeface } of usable) {
            if (!isCurrent()) {
              disposeUnpublishedOwner(unpublished());
              return;
            }
            fontManager.registerFont(typeface as never, asset.family);
            fontFamilies.push(asset.family);
          }
          if (fontFamilies.length > 0) {
            if (!isCurrent()) {
              disposeUnpublishedOwner(unpublished());
              return;
            }
            const provider = fontManager;
            shapingProvider = new WebShapedRunProvider(
              (request) => {
                const builder = Skia.ParagraphBuilder.Make({}, provider);
                builder.pushStyle({
                  fontFamilies,
                  fontSize: request.fontSize,
                  color: Skia.Color('#172033'),
                });
                builder.addText(request.text);
                const paragraph = builder.build();
                paragraph.layout(request.paragraphLayoutWidth);
                return paragraph;
              },
              (typeface, size, scaleX) => {
                try {
                  const font = Skia.Font(typeface as never, size);
                  if (!font) return null;
                  font.setScaleX(scaleX);
                  return font;
                } catch {
                  return null;
                }
              }
            );
            if (!isCurrent()) {
              disposeUnpublishedOwner(unpublished());
              return;
            }
          }
        }

        if (!isCurrent()) {
          disposeUnpublishedOwner(unpublished());
          return;
        }
        const resourceRevision = ++resourceRevisionRef.current;
        const owner: FontOwner = {
          resourceRevision,
          providerIdentity: `provider-${resourceRevision}`,
          fontManager,
          fontFamilies: Object.freeze(fontFamilies),
          shapingProvider,
          tierErrors,
          fontsByTier,
          manifestError: null,
          summary:
            tierErrors.size > 0
              ? `生产字体部分不可用：${[...tierErrors.keys()].join('、')}`
              : `已注册生产字体：${usable.map(({ asset }) => asset.id).join('、') || '无'}`,
        };
        publishedOwnerRef.current = owner;
        publishedOwnersRef.current.push(owner);
        published = true;
        diagnostics?.increment('font-effects-published');
        setState(makeAssetsState(owner, new Set()));
      } catch (error) {
        disposeUnpublishedOwner(unpublished());
        if (!isCurrent()) return;
        const resourceRevision = ++resourceRevisionRef.current;
        const owner: FontOwner = {
          resourceRevision,
          providerIdentity: `provider-${resourceRevision}-failed`,
          fontManager: null,
          fontFamilies: [],
          shapingProvider: null,
          tierErrors,
          fontsByTier: new Map(),
          manifestError: errorMessage(error),
          summary: '生产字体初始化失败',
        };
        publishedOwnerRef.current = owner;
        publishedOwnersRef.current.push(owner);
        published = true;
        diagnostics?.increment('font-effects-published');
        setState(makeAssetsState(owner, new Set()));
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      if (!published) diagnostics?.increment('font-effects-cancelled');
    };
  }, [diagnostics, requiredTierSignature, retryGeneration]);

  return state;
}

function requestKey(request: FrameTextRequest, assets: CandidateFontAssets): string {
  return `${assets.resourceRevision}\u0000${assets.providerIdentity}\u0000${request.revision}`;
}

/** Frame 只读取 ready program；单条 pending/error 文本会同时退出 render/hit。 */
export function useCandidateTextShaping(
  assets: CandidateFontAssets,
  requests: readonly FrameTextRequest[]
): CandidateTextShaping {
  const requestsKey = requests.map((request) => requestKey(request, assets)).join('\u0000');
  const [records, setRecords] = useState<ReadonlyMap<string, ShapingRecord>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shapingGenerationRef = useRef(0);
  const providerKey = `${assets.resourceRevision}:${assets.providerIdentity}`;
  const publishedProviderKeyRef = useRef(providerKey);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  useEffect(() => {
    if (publishedProviderKeyRef.current === providerKey) return;
    publishedProviderKeyRef.current = providerKey;
    // A new owner means a new provider cache. Records from the former provider are never reusable.
    shapingGenerationRef.current += 1;
    setRecords(new Map());
  }, [providerKey]);

  useEffect(() => {
    if (assets.phase !== 'ready' || requests.length === 0) return;
    const timeout = setTimeout(() => {
      setRecords((current) => {
        const next = new Map(current);
        for (const request of requests) {
          if (assets.requestState(request).phase !== 'ready') continue;
          const key = requestKey(request, assets);
          if (next.get(key)?.phase !== 'ready') {
            next.set(key, {
              phase: 'error',
              cursor: next.get(key)?.cursor ?? 0,
              message: '文本 shaping 超过 5 秒',
            });
          }
        }
        return next;
      });
    }, SHAPING_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [assets, requests]);

  useEffect(() => {
    if (assets.phase !== 'ready' || requests.length === 0 || timerRef.current !== null) return;
    const request = requests.find((candidate) => {
      if (assets.requestState(candidate).phase !== 'ready') return false;
      const phase = records.get(requestKey(candidate, assets))?.phase;
      return phase !== 'ready' && phase !== 'error';
    });
    if (!request || !assets.shapingProvider) return;
    const key = requestKey(request, assets);
    const previous = records.get(key);
    const shapingGeneration = shapingGenerationRef.current;
    const provider = assets.shapingProvider;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (shapingGeneration !== shapingGenerationRef.current) return;
      try {
        const result = provider.prepare(
          request,
          provider.continuation(request, previous?.cursor ?? 0, 1)
        );
        if (shapingGeneration !== shapingGenerationRef.current) return;
        setRecords((current) => {
          if (shapingGeneration !== shapingGenerationRef.current) return current;
          const next = new Map(current);
          if (result.state === 'ready')
            next.set(key, { phase: 'ready', cursor: previous?.cursor ?? 0 });
          else if (result.state === 'pending')
            next.set(key, { phase: 'pending', cursor: result.cursor });
          else
            next.set(key, {
              phase: 'error',
              cursor: previous?.cursor ?? 0,
              message: result.reason,
            });
          return next;
        });
      } catch (error) {
        if (shapingGeneration !== shapingGenerationRef.current) return;
        setRecords((current) =>
          new Map(current).set(key, {
            phase: 'error',
            cursor: previous?.cursor ?? 0,
            message: errorMessage(error),
          })
        );
      }
    }, 16);
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [assets, records, requests]);

  const counts = requests.reduce(
    (current, request) => {
      const resource = assets.requestState(request);
      if (resource.phase === 'error') {
        current.error += 1;
        if (!current.message) current.message = resource.message;
        return current;
      }
      if (resource.phase === 'pending') {
        current.pending += 1;
        return current;
      }
      const record = records.get(requestKey(request, assets));
      if (record?.phase === 'ready') current.ready += 1;
      else if (record?.phase === 'error') {
        current.error += 1;
        if (!current.message && record.message) current.message = record.message;
      } else current.pending += 1;
      return current;
    },
    { ready: 0, pending: 0, error: 0, message: null as string | null }
  );
  const phase: CandidateTextShaping['phase'] =
    counts.error > 0 ? 'error' : counts.pending > 0 ? 'pending' : 'ready';
  const programRevision = `${providerKey}:${requestsKey}:${requests
    .map((request) => {
      const resource = assets.requestState(request);
      const record = records.get(requestKey(request, assets));
      return `${resource.phase}:${record?.phase ?? 'pending'}:${record?.cursor ?? 0}`;
    })
    .join(',')}`;
  const resolveTextProgram = (request: FrameTextRequest): FrameTextProgram | null => {
    // pending/error 请求必须显式返回 empty-text，覆写 frameClipping 为完整文本预置的
    // safeParagraphProgram 回退：否则该 entry 仍会被视为 renderable 并被 hitTest 命中。
    // 这里只让单条文本退出 render/hit，不影响同一 Canvas 上其它 entry 与 frame 生命周期。
    if (assets.requestState(request).phase !== 'ready') return EMPTY_TEXT_PROGRAM;
    if (records.get(requestKey(request, assets))?.phase !== 'ready') return EMPTY_TEXT_PROGRAM;
    // 仅 ready 路径返回 provider 的真实 program；cache 未命中时保留既有 null 语义。
    return assets.shapingProvider?.getCached(request) ?? null;
  };

  return {
    phase,
    programRevision,
    ...counts,
    entries: requests.map((request) => {
      const resource = assets.requestState(request);
      if (resource.phase !== 'ready') return resource;
      const record = records.get(requestKey(request, assets));
      return record?.phase === 'error'
        ? { phase: 'error', message: record.message ?? '文本 shaping 失败' }
        : { phase: record?.phase ?? 'pending', message: null };
    }),
    resolveTextProgram,
  };
}
