import { defineConfig } from '@playwright/test';

const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);

export default defineConfig({
  testDir: 'tests/ui',
  timeout: 120000,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5266',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--no-sandbox', '--disabled-setuid-sandbox'],
    },
  },
  webServer: {
    // Expo 57 在非 headless 模式会尝试安装 React Native DevTools；Linux CI/Playwright
    // 容器没有可用的 Chrome SUID sandbox，安装失败会让开发服务器提前退出。
    command:
      "env EXPO_UNSTABLE_HEADLESS=1 EXPO_NO_DEPENDENCY_VALIDATION=0 EXPO_NO_NEW_ARCH_COMPAT_CHECK=0 sh -c 'pnpm run prepare:playground-artifacts && pnpm dev'",
    port: 5266,
    reuseExistingServer: !isCI,
    // 构件准备会重建 Bob 产物并校验字体；冷缓存下通常超过本地默认 30 秒。
    // 这只延长服务就绪窗口，不改变测试或应用超时语义。
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
