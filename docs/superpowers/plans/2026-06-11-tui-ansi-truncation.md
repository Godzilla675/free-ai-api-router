# TUI ANSI Truncation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement robust ANSI-aware line truncation in `formatTuiLine` to prevent TUI rendering bugs (such as layout shifts/overflows from long log entries or window resizing) and write comprehensive unit tests.

**Architecture:** The helper function `formatTuiLine` currently pads lines with spaces up to a specified width. If the line is longer than the width, it wraps, which breaks the fixed-layout TUI. We will rewrite it to parse ANSI escape codes and truncate the visible text at `width` while keeping color and reset codes intact.

**Tech Stack:** TypeScript, Vitest

---

## Task 1: Refactor formatTuiLine with ANSI-Aware Truncation

**Files:**
- Modify: [src/dashboard-helper.ts](file:///C:/Users/Ahmed/Desktop/free%20models%20api/src/dashboard-helper.ts)
- Test: [tests/dashboard.test.ts](file:///C:/Users/Ahmed/Desktop/free%20models%20api/tests/dashboard.test.ts)

- [ ] **Step 1: Write the failing tests**
  Add test cases in `tests/dashboard.test.ts` that test truncating long lines (both plain text and lines with ANSI escape sequences).

  ```typescript
  it('truncates plain text lines longer than width', () => {
    const output = formatTuiLine('Hello World', 5);
    expect(output).toBe('Hello\x1b[0m');
  });

  it('truncates lines with ANSI escape sequences and appends reset code', () => {
    const greenText = '\x1b[32mHello World\x1b[0m';
    const output = formatTuiLine(greenText, 5);
    // Visual length: 5 (Hello)
    // The escape code \x1b[32m should be preserved, and \x1b[0m appended at the end
    expect(output).toBe('\x1b[32mHello\x1b[0m');
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**
  Run: `npx vitest run tests/dashboard.test.ts`
  Expected: FAIL

- [ ] **Step 3: Implement ANSI-aware truncation**
  Update `formatTuiLine` in `src/dashboard-helper.ts` to iterate character-by-character, handle escape sequences, truncate visible text, and append reset sequences when truncated or padded.

  ```typescript
  export function formatTuiLine(text: string, width: number): string {
    let visibleCount = 0;
    let result = '';
    let i = 0;
    
    while (i < text.length) {
      if (text[i] === '\x1b') {
        let j = i + 1;
        if (text[j] === '[') {
          j++;
          while (j < text.length && !/[a-zA-Z]/.test(text[j]!)) {
            j++;
          }
          if (j < text.length) {
            j++;
          }
        }
        result += text.slice(i, j);
        i = j;
      } else {
        if (visibleCount < width) {
          result += text[i];
          visibleCount++;
        }
        i++;
      }
    }

    if (visibleCount < width) {
      result += ' '.repeat(width - visibleCount);
    } else {
      result += '\x1b[0m';
    }
    return result;
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**
  Run: `npx vitest run tests/dashboard.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add src/dashboard-helper.ts tests/dashboard.test.ts
  git commit -m "feat: implement ANSI-aware line truncation in formatTuiLine and add unit tests"
  ```

---

## Task 2: Verify Full Codebase CI

**Files:** None

- [ ] **Step 1: Build production code**
  Run: `npm run build`
  Expected: Success

- [ ] **Step 2: Run typecheck**
  Run: `npm run typecheck`
  Expected: Success

- [ ] **Step 3: Run all unit tests**
  Run: `npm test`
  Expected: All 128 tests pass

- [ ] **Step 4: Run smoke tests**
  Run: `npm run smoke`
  Expected: Success
