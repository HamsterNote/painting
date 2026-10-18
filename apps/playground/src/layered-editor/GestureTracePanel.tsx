import { useState } from 'react';
import type { GestureTrace } from './gestureTrace';

export function GestureTracePanel({ trace }: { trace: GestureTrace }) {
  const [output, setOutput] = useState('');
  const [message, setMessage] = useState('手势记录已开启，复现后导出。');
  function exportTrace() {
    const text = JSON.stringify(trace.snapshot(), null, 2);
    setOutput(text);
    setMessage('已生成记录，可复制全文或下载文件。');
    return text;
  }
  async function copy() {
    const text = exportTrace();
    try {
      await navigator.clipboard.writeText(text);
      setMessage('记录已复制。');
    } catch {
      setMessage('请在下方记录框长按全选并复制，或下载文件。');
    }
  }
  function download() {
    const text = exportTrace();
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'painting-gesture-trace.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <details data-testid="gesture-trace-panel" style={{ flexShrink: 0, padding: 4 }}>
      <summary>手势诊断（记录中）</summary>
      <p role="status">{message}</p>
      <button type="button" onClick={exportTrace}>
        查看记录
      </button>{' '}
      <button type="button" onClick={copy}>
        复制记录
      </button>{' '}
      <button type="button" onClick={download}>
        下载记录
      </button>
      {output ? (
        <textarea
          aria-label="手势记录"
          readOnly
          value={output}
          onFocus={(event) => event.currentTarget.select()}
          style={{ display: 'block', width: '100%', height: 160, boxSizing: 'border-box' }}
        />
      ) : null}
    </details>
  );
}
