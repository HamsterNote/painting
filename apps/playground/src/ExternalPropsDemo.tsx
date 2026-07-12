import { DrawingSurface, type DrawingValue } from '@hamster-note/painting';
import { useCallback, useRef, useState } from 'react';

const EXTERNAL_TARGET_SEED_VALUE: DrawingValue = {
  strokes: [
    {
      id: 'external-overflow-seed',
      tool: 'pen',
      strokeColor: '#7c3aed',
      strokeWidth: 8,
      points: [
        { x: -28, y: 42 },
        { x: 40, y: 22 },
        { x: 170, y: 86 },
        { x: 300, y: 252 },
        { x: 428, y: 218 },
      ],
    },
  ],
};

type ExternalDemoEventTargetMode = 'surface' | 'parent';
type ExternalDemoOverflowMode = 'hidden' | 'visible';

export function ExternalPropsDemo() {
  const [value, setValue] = useState<DrawingValue>(EXTERNAL_TARGET_SEED_VALUE);
  const [eventTargetMode, setEventTargetMode] = useState<ExternalDemoEventTargetMode>('parent');
  const [overflowMode, setOverflowMode] = useState<ExternalDemoOverflowMode>('visible');
  const parentRef = useRef<HTMLDivElement>(null);

  const handleChange = useCallback((nextValue: DrawingValue) => {
    setValue(nextValue);
  }, []);

  const handleReset = useCallback(() => {
    setValue(EXTERNAL_TARGET_SEED_VALUE);
  }, []);

  const surfaceProps = eventTargetMode === 'parent' ? { eventTarget: parentRef } : {};

  return (
    <div
      style={{
        marginTop: '30px',
        borderTop: '1px solid #ddd',
        paddingTop: '20px',
      }}
    >
      <h2>eventTarget + overflow props Demo</h2>
      <p style={{ color: '#666', fontSize: '14px', marginBottom: '12px' }}>
        这个 Demo 专门展示两个新增属性：<code>eventTarget</code> 可以把绘制事件绑定到紫色父容器，
        <code>overflow</code> 控制根 SVG 是否裁剪越界笔迹。
      </p>

      <fieldset
        data-testid="external-props-controls"
        style={{
          border: '1px solid #d8b4fe',
          borderRadius: '10px',
          padding: '10px 12px',
          margin: '0 0 16px',
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          alignItems: 'center',
          backgroundColor: '#fbf7ff',
        }}
      >
        <legend>
          <strong>新增 props 控制</strong>
        </legend>
        <label>
          eventTarget{' '}
          <select
            data-testid="external-event-target-mode"
            value={eventTargetMode}
            onChange={(e) => {
              switch (e.target.value) {
                case 'parent':
                  setEventTargetMode('parent');
                  break;
                case 'surface':
                  setEventTargetMode('surface');
                  break;
              }
            }}
          >
            <option value="parent">parent ref（父级接收事件）</option>
            <option value="surface">default surface（只监听 SVG）</option>
          </select>
        </label>
        <label>
          overflow{' '}
          <select
            data-testid="external-overflow-mode"
            value={overflowMode}
            onChange={(e) => {
              switch (e.target.value) {
                case 'visible':
                  setOverflowMode('visible');
                  break;
                case 'hidden':
                  setOverflowMode('hidden');
                  break;
              }
            }}
          >
            <option value="visible">visible（显示越界笔迹）</option>
            <option value="hidden">hidden（裁剪到 SVG 内）</option>
          </select>
        </label>
        <button type="button" data-testid="external-demo-reset" onClick={handleReset}>
          Reset demo stroke
        </button>
        <span style={{ color: '#6b21a8', fontSize: '13px' }}>
          当前：eventTarget = {eventTargetMode === 'parent' ? 'parent ref' : 'default'}，overflow ={' '}
          {overflowMode}
        </span>
      </fieldset>

      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div
          ref={parentRef}
          data-testid="external-event-parent-demo"
          style={{
            width: '464px',
            minHeight: '364px',
            border: '2px dashed #7c3aed',
            borderRadius: '12px',
            padding: '32px',
            touchAction: 'none',
            backgroundColor: '#faf5ff',
            position: 'relative',
          }}
        >
          <div
            style={{
              marginBottom: '12px',
              color: '#6b21a8',
              fontSize: '13px',
              pointerEvents: 'none',
            }}
          >
            在父容器紫色 padding 区域按下并拖动：选择 parent ref 时会绘制，选择 default surface 时不会绘制。
          </div>
          <div
            style={{
              width: '400px',
              height: '300px',
              outline: '2px solid #c084fc',
              outlineOffset: 0,
              backgroundColor: '#fff',
            }}
          >
            <DrawingSurface
              value={value}
              onChange={handleChange}
              {...surfaceProps}
              overflow={overflowMode}
              tool="pen"
              strokeColor="#7c3aed"
              strokeWidth={3}
              strokeSmoothing={false}
              testID="drawing-surface-external-target"
            />
          </div>
          <div
            style={{
              marginTop: '12px',
              color: '#6b21a8',
              fontSize: '12px',
              pointerEvents: 'none',
            }}
          >
            初始紫色粗线包含 x &lt; 0 和 x &gt; 400 的点，用来观察 overflow visible / hidden 的裁剪差异。
          </div>
        </div>
        <div style={{ flex: 1, minWidth: '360px' }}>
          <h3 style={{ marginTop: 0 }}>代码对应关系</h3>
          <pre
            data-testid="external-props-code-preview"
            style={{
              maxHeight: '170px',
              overflow: 'auto',
              backgroundColor: '#1f102e',
              color: '#f5e8ff',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '12px',
            }}
          >
            {`<DrawingSurface\n  eventTarget={${eventTargetMode === 'parent' ? 'parentRef' : 'undefined'}}\n  overflow="${overflowMode}"\n/>`}
          </pre>
          <pre
            data-testid="drawing-preview-external-target"
            style={{
              maxHeight: '230px',
              overflow: 'auto',
              backgroundColor: '#f5f5f5',
              padding: '10px',
              borderRadius: '4px',
              fontSize: '12px',
            }}
          >
            {JSON.stringify(value, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
