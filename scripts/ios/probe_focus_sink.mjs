import { createRequire } from 'node:module';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const results = [];
try {
  for (const variant of [
    'textarea',
    'contenteditable',
    'inert',
    'display-none',
    'visibility-hidden',
  ]) {
    const page = await browser.newPage();
    await page.setContent(`<button id="before">Before</button>
      ${variant === 'contenteditable' ? '<div id="sink" contenteditable="true"></div>' : '<textarea id="sink"></textarea>'}
      <button id="after">After</button>`);
    await page.evaluate((variant) => {
      const sink = document.getElementById('sink');
      sink.setAttribute('aria-hidden', 'true');
      sink.tabIndex = -1;
      Object.assign(sink.style, {
        position: 'fixed',
        width: '1px',
        height: '1px',
        opacity: '0',
        clipPath: 'inset(50%)',
        pointerEvents: 'none',
      });
      if (variant === 'inert') sink.inert = true;
      if (variant === 'display-none') sink.style.display = 'none';
      if (variant === 'visibility-hidden') sink.style.visibility = 'hidden';
      window.keys = [];
      document.addEventListener('keydown', (e) =>
        window.keys.push({ key: e.key, target: e.target.id, isTrusted: e.isTrusted })
      );
      sink.focus();
    }, variant);
    const client = await page.context().newCDPSession(page);
    const dom = await client.send('DOM.getDocument');
    const { nodeId } = await client.send('DOM.querySelector', {
      nodeId: dom.root.nodeId,
      selector: '#sink',
    });
    const { node } = await client.send('DOM.describeNode', { nodeId });
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    const ax = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
    const active = await page.evaluate(() => document.activeElement.id);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');
    results.push({
      variant,
      active,
      ax: ax
        ? {
            ignored: ax.ignored,
            role: ax.role,
            properties: ax.properties,
            ignoredReasons: ax.ignoredReasons,
          }
        : null,
      after: await page.evaluate(() => ({ active: document.activeElement.id, keys: window.keys })),
    });
    await page.close();
  }
  console.log(JSON.stringify({ browser: browser.version(), results }, null, 2));
} finally {
  await browser.close();
}
