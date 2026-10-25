import { defineConfig, configDefaults } from 'vitest/config';

// GitHub Pages serves the project under /truck-sim/.
// Agent worktrees live under .claude/; their tests aren't this checkout's.
export default defineConfig({
  base: '/truck-sim/',
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
