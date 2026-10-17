/** 图片笔迹可携带的稳定资源标识与始终可用的 src 回退值。 */
export type ImageResourceReference = Readonly<{
  resourceId?: string;
  src: string;
}>;

/** 不含 I/O 或平台对象的已登记图片资源元数据。 */
export type ImageResourceRecord = Readonly<{
  resourceId: string;
  src: string;
  naturalWidth?: number;
  naturalHeight?: number;
}>;

/** 资源表以有序记录保存，便于纯函数解析与确定性的 src 回退。 */
export type ResourceRegistry = Readonly<{
  records: readonly ImageResourceRecord[];
}>;

/** 登记时发现的非致命资源表问题。 */
export type ResourceRegistryDiagnostic = Readonly<{
  type: 'resource-id-collision';
  resourceId: string;
  existing: ImageResourceRecord;
  incoming: ImageResourceRecord;
}>;

/** 登记操作的不可变结果。 */
export type RegisterImageResourceResult = Readonly<{
  registry: ResourceRegistry;
  diagnostics: readonly ResourceRegistryDiagnostic[];
}>;

/** 解析操作的纯结果；未找到时 resource 为 undefined。 */
export type ResolveImageResourceResult = Readonly<{
  resource?: ImageResourceRecord;
}>;

const EMPTY_RECORDS: readonly ImageResourceRecord[] = Object.freeze([]);
const NO_DIAGNOSTICS: readonly ResourceRegistryDiagnostic[] = Object.freeze([]);

function copyRecord(record: ImageResourceRecord): ImageResourceRecord {
  return {
    resourceId: record.resourceId,
    src: record.src,
    ...(record.naturalWidth === undefined ? {} : { naturalWidth: record.naturalWidth }),
    ...(record.naturalHeight === undefined ? {} : { naturalHeight: record.naturalHeight }),
  };
}

function recordsMatch(left: ImageResourceRecord, right: ImageResourceRecord): boolean {
  return (
    left.resourceId === right.resourceId &&
    left.src === right.src &&
    left.naturalWidth === right.naturalWidth &&
    left.naturalHeight === right.naturalHeight
  );
}

/** 创建空资源表；所有记录都必须经 register 进入，以保留碰撞 diagnostic。 */
export function createResourceRegistry(): ResourceRegistry {
  return { records: EMPTY_RECORDS };
}

/**
 * 登记一条图片资源。
 *
 * 完全相同的资源是幂等操作；相同 ID 对应不同数据时保留既有记录并返回 collision
 * diagnostic，避免任何隐式覆盖或 ID 生成。
 */
export function registerImageResource(
  registry: ResourceRegistry,
  record: ImageResourceRecord
): RegisterImageResourceResult {
  const existing = registry.records.find(({ resourceId }) => resourceId === record.resourceId);
  if (existing) {
    if (recordsMatch(existing, record)) {
      return { registry, diagnostics: NO_DIAGNOSTICS };
    }

    return {
      registry,
      diagnostics: [
        {
          type: 'resource-id-collision',
          resourceId: record.resourceId,
          existing: copyRecord(existing),
          incoming: copyRecord(record),
        },
      ],
    };
  }

  return {
    registry: { records: [...registry.records, copyRecord(record)] },
    diagnostics: NO_DIAGNOSTICS,
  };
}

/**
 * 解析图片引用。resourceId 命中优先；缺失或未命中时精确匹配 src，并返回登记顺序中的第一条。
 */
export function resolveImageResource(
  registry: ResourceRegistry,
  reference: ImageResourceReference
): ResolveImageResourceResult {
  const resourceById =
    reference.resourceId === undefined
      ? undefined
      : registry.records.find(({ resourceId }) => resourceId === reference.resourceId);
  const resource = resourceById ?? registry.records.find(({ src }) => src === reference.src);
  return resource === undefined ? {} : { resource: copyRecord(resource) };
}

/** 删除指定 ID 的登记资源；不存在时保留原 registry 引用。 */
export function removeImageResource(registry: ResourceRegistry, resourceId: string): ResourceRegistry {
  const index = registry.records.findIndex((record) => record.resourceId === resourceId);
  if (index === -1) {
    return registry;
  }

  return {
    records: [...registry.records.slice(0, index), ...registry.records.slice(index + 1)],
  };
}
