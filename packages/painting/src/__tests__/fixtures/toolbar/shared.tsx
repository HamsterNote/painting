import { useState } from 'react';
import type {
  ToolbarFile,
  ToolbarFileRequest,
  ToolbarRequestResult,
} from '@hamster-note/painting/toolbar';

export const files: readonly ToolbarFile[] = [
  {
    key: 's1/A.pdf',
    storageId: 's1',
    path: '/docs/A.pdf',
    displayName: 'A.pdf',
    resolvedFormat: 'pdf',
  },
  {
    key: 's1/B.hnn',
    storageId: 's1',
    path: '/notes/B.hnn',
    displayName: 'B.hnn',
    resolvedFormat: 'hnn',
  },
  {
    key: 's1/C.hpb',
    storageId: 's1',
    path: '/boards/C.hpb',
    displayName: 'C.hpb',
    resolvedFormat: 'hpb',
  },
  {
    key: 's2/A.pdf',
    storageId: 's2',
    path: '/docs/A.pdf',
    displayName: 'A.pdf',
    resolvedFormat: 'pdf',
  },
];

export function useFixtureHost() {
  const [edge, setEdge] = useState<'top' | 'bottom'>('bottom');
  const [safe, setSafe] = useState(34);
  const [mode, setMode] = useState('success');
  const [current, setCurrent] = useState(files[0].key);
  const [requests, setRequests] = useState<ToolbarFileRequest[]>([]);
  const onSelectFile = async (request: ToolbarFileRequest): Promise<ToolbarRequestResult> => {
    setRequests((items) => [...items, request]);
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (mode === 'failed') return { status: 'failed', message: '保存失败，请重试' };
    if (mode === 'cancelled') return { status: 'cancelled' };
    setCurrent(request.fileKey);
    return { status: 'success' };
  };
  return {
    edge,
    current,
    onSelectFile,
    layout: { edge, insets: { top: 24, bottom: safe, left: 0, right: 0 }, headerContentInset: 44 },
    controls: (
      <div style={{ display: 'flex', gap: 8, height: 56, alignItems: 'center' }}>
        <button onClick={() => setEdge(edge === 'top' ? 'bottom' : 'top')}>迁移边缘</button>
        <button onClick={() => setSafe(safe === 0 ? 34 : 0)}>切换零安全区</button>
        <select
          aria-label="请求结果"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="success">成功</option>
          <option value="cancelled">取消</option>
          <option value="failed">失败</option>
        </select>
        <output data-testid="requests">{JSON.stringify(requests)}</output>
      </div>
    ),
  };
}
