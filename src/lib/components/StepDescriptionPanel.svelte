<script lang="ts">
  import { tick } from 'svelte';
  import { Textarea } from '$lib/components/ui/textarea';
  import { parseKeystrokes } from '$lib/utils';

  interface Props {
    descriptionDraft: string;
    keystrokesDraft: string;
    onfocus: () => void;
    onblur: () => void;
    onkeystrokesblur: () => void;
  }

  let {
    descriptionDraft = $bindable(),
    keystrokesDraft = $bindable(),
    onfocus,
    onblur,
    onkeystrokesblur,
  }: Props = $props();

  let keystrokesEl = $state<HTMLDivElement | null>(null);

  function createScrollFade() {
    let canScrollUp = $state(false);
    let canScrollDown = $state(false);

    function update(el: HTMLElement | null) {
      if (!el) return;
      canScrollUp = el.scrollTop > 1;
      canScrollDown = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    }

    return {
      get canScrollUp() { return canScrollUp; },
      get canScrollDown() { return canScrollDown; },
      update,
    };
  }

  const descFade = createScrollFade();
  const keyFade = createScrollFade();
  let descRef = $state<HTMLTextAreaElement | null>(null);

  $effect(() => {
    descriptionDraft;
    tick().then(() => descFade.update(descRef));
  });
  $effect(() => {
    keystrokesDraft;
    tick().then(() => keyFade.update(keystrokesEl));
  });

  function escapeHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  const ZWS = '\u200B'; // zero-width space — invisible cursor landing spot

  // Convert keystrokesDraft → HTML for the contenteditable div.
  // Inserts zero-width spaces around <kbd> elements so the cursor can
  // land outside them (contenteditable can't place the caret between
  // two adjacent inline elements without a text node in between).
  let keystrokesHtml = $derived.by(() => {
    if (!keystrokesDraft) return '';
    const segments = parseKeystrokes(keystrokesDraft);
    let html = '';
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.kind === 'shortcut') {
        // Add ZWS before kbd if previous segment was also a shortcut or this is the first node
        const prev = segments[i - 1];
        if (!prev || prev.kind === 'shortcut') html += ZWS;
        html += `<kbd class="inline items-center rounded border border-border bg-muted px-1 py-0.5 font-mono text-xs font-medium">${escapeHtml(seg.key)}</kbd>`;
        // Add ZWS after kbd if next segment is also a shortcut or this is the last node
        const next = segments[i + 1];
        if (!next || next.kind === 'shortcut') html += ZWS;
      } else {
        html += escapeHtml(seg.value);
      }
    }
    return html;
  });

  // Read plain text back from contenteditable, wrapping kbd contents in [].
  // Strips zero-width spaces used as cursor landing spots.
  function readPlainText(el: HTMLElement): string {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += (node.textContent ?? '').replaceAll(ZWS, '');
      } else if (node instanceof HTMLElement && node.tagName === 'KBD') {
        text += `[${node.textContent ?? ''}]`;
      } else if (node instanceof HTMLElement) {
        text += (node.textContent ?? '').replaceAll(ZWS, '');
      }
    }
    return text;
  }

  /** Measure the cursor's character offset within the plain-text model. */
  function getCursorOffset(el: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return -1;
    const range = sel.getRangeAt(0);
    const preRange = document.createRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.startContainer, range.startOffset);
    // Read the text of everything before the cursor using a temporary
    // contenteditable-aware extraction (same logic as readPlainText but on a fragment).
    const frag = preRange.cloneContents();
    const tmp = document.createElement('div');
    tmp.appendChild(frag);
    return readPlainText(tmp).length;
  }

  /** Restore cursor to a character offset in the plain-text model. */
  function setCursorOffset(el: HTMLElement, target: number) {
    let remaining = target;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      // Skip ZWS-only text nodes for counting purposes, but they still exist in DOM
      const clean = node.textContent?.replaceAll(ZWS, '') ?? '';
      if (clean.length === 0) continue;
      if (remaining <= clean.length) {
        // Map clean offset back to raw offset (account for ZWS characters)
        const raw = node.textContent ?? '';
        let cleanIdx = 0;
        let rawIdx = 0;
        while (cleanIdx < remaining && rawIdx < raw.length) {
          if (raw[rawIdx] !== ZWS) cleanIdx++;
          rawIdx++;
        }
        const sel = window.getSelection();
        if (sel) {
          sel.collapse(node, rawIdx);
        }
        return;
      }
      remaining -= clean.length;
    }
    // Fallback: place cursor at end
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
  }

  /** Re-render contenteditable HTML and restore cursor position. */
  function rerenderKeystrokesHtml() {
    if (!keystrokesEl) return;
    const offset = getCursorOffset(keystrokesEl);
    keystrokesEl.innerHTML = keystrokesHtml;
    if (offset >= 0) {
      setCursorOffset(keystrokesEl, offset);
    }
  }

  function onKeystrokesInput() {
    if (!keystrokesEl) return;
    const newText = readPlainText(keystrokesEl);
    const oldText = keystrokesDraft;
    keystrokesDraft = newText;

    // If a ] was just typed and closes a bracket pair, re-render to convert to <kbd>.
    if (newText !== oldText && newText.includes(']')) {
      // Check if the new text has a different set of [...] groups than what's in the DOM.
      const hasNewShortcut = parseKeystrokes(newText).some(
        (s) => s.kind === 'shortcut',
      );
      if (hasNewShortcut) {
        rerenderKeystrokesHtml();
      }
    }
  }

  // Sync HTML into contenteditable when keystrokesDraft changes externally
  // (e.g. switching steps). Only update DOM if it diverged from the model.
  $effect(() => {
    const html = keystrokesHtml;
    if (!keystrokesEl) return;
    if (readPlainText(keystrokesEl) !== keystrokesDraft) {
      keystrokesEl.innerHTML = html;
    }
  });
</script>

<div class="flex flex-col gap-3 lg:flex-row lg:items-stretch">
  <div class="flex flex-col lg:flex-1">
    <label for="step-description" class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</label>
    <div class="relative flex-1">
      <Textarea
        id="step-description"
        bind:ref={descRef}
        bind:value={descriptionDraft}
        placeholder="Describe what the user should do in this step"
        spellcheck="false"
        autocomplete="off"
        class="h-full max-h-24 resize-none [scrollbar-width:none]"
        {onfocus}
        {onblur}
        onscroll={() => descFade.update(descRef)}
      />
      {#if descFade.canScrollUp}
        <div class="pointer-events-none absolute top-[1px] right-[1px] left-[1px] h-8 rounded-t-md bg-gradient-to-b from-background from-10% to-transparent dark:from-[color-mix(in_oklch,var(--foreground)_4%,var(--background))]"></div>
      {/if}
      {#if descFade.canScrollDown}
        <div class="pointer-events-none absolute right-[1px] bottom-[1px] left-[1px] h-8 rounded-b-md bg-gradient-to-t from-background from-10% to-transparent dark:from-[color-mix(in_oklch,var(--foreground)_4%,var(--background))]"></div>
      {/if}
    </div>
  </div>

  <div class="flex flex-col lg:flex-1">
    <label for="step-keystrokes" class="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">Keystrokes</label>
    <div class="relative flex-1">
      <div
        id="step-keystrokes"
        bind:this={keystrokesEl}
        contenteditable="true"
        role="textbox"
        spellcheck="false"
        data-placeholder="Type text or wrap key combos in brackets, e.g. [Ctrl+S]"
        class="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-full max-h-24 min-h-16 w-full overflow-y-auto rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px] md:text-sm [scrollbar-width:none] empty:before:text-muted-foreground empty:before:content-[attr(data-placeholder)]"
        onfocus={onfocus}
        onblur={() => { onblur(); onkeystrokesblur(); }}
        oninput={onKeystrokesInput}
        onscroll={() => keyFade.update(keystrokesEl)}
      ></div>
      {#if keyFade.canScrollUp}
        <div class="pointer-events-none absolute top-[1px] right-[1px] left-[1px] h-8 rounded-t-md bg-gradient-to-b from-background from-10% to-transparent dark:from-[color-mix(in_oklch,var(--foreground)_4%,var(--background))]"></div>
      {/if}
      {#if keyFade.canScrollDown}
        <div class="pointer-events-none absolute right-[1px] bottom-[1px] left-[1px] h-8 rounded-b-md bg-gradient-to-t from-background from-10% to-transparent dark:from-[color-mix(in_oklch,var(--foreground)_4%,var(--background))]"></div>
      {/if}
    </div>
  </div>
</div>
