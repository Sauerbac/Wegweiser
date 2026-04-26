<script lang="ts">
  import * as Select from '$lib/components/ui/select';
  import type { FabricCanvasWrapper } from '$lib/fabric-canvas.svelte';
  import type { ArrowHeadType } from '$lib/editor/tools/tool-handler';

  interface Props {
    fabricCanvas: FabricCanvasWrapper;
  }

  let { fabricCanvas }: Props = $props();

  const headTypes: { value: ArrowHeadType; label: string }[] = [
    { value: 'none', label: 'None' },
    { value: 'arrow', label: 'Arrow' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'circle', label: 'Circle' },
    { value: 'bar', label: 'Bar' },
  ];

  const L = `stroke="currentColor" stroke-width="1.5" stroke-linecap="round"`;
  const FULL   = `<line x1="2" y1="8" x2="14" y2="8" ${L}/>`;
  const SHORTR = `<line x1="2" y1="8" x2="11" y2="8" ${L}/>`;
  const SHORTL = `<line x1="5" y1="8" x2="14" y2="8" ${L}/>`;

  const icons: Record<'start' | 'end', Record<ArrowHeadType, string>> = {
    end: {
      none:     FULL,
      arrow:    SHORTR + `<path d="M 11,5 L 14,8 L 11,11" ${L} stroke-linejoin="round" fill="none"/>`,
      triangle: SHORTR + `<polygon points="14,8 10,5.5 10,10.5" fill="currentColor"/>`,
      circle:   SHORTR + `<circle cx="13" cy="8" r="2" fill="currentColor"/>`,
      bar:      FULL   + `<line x1="14" y1="5" x2="14" y2="11" ${L}/>`,
    },
    start: {
      none:     FULL,
      arrow:    SHORTL + `<path d="M 5,5 L 2,8 L 5,11" ${L} stroke-linejoin="round" fill="none"/>`,
      triangle: SHORTL + `<polygon points="2,8 6,5.5 6,10.5" fill="currentColor"/>`,
      circle:   SHORTL + `<circle cx="3" cy="8" r="2" fill="currentColor"/>`,
      bar:      FULL   + `<line x1="2" y1="5" x2="2" y2="11" ${L}/>`,
    },
  };
</script>

<div class="space-y-1.5">
  <p class="text-xs font-medium text-muted-foreground">Arrow heads</p>
  <div class="flex gap-1.5">

    <!-- Start head -->
    <div class="flex flex-1 flex-col gap-1">
      <p class="text-xs text-muted-foreground/70">Start</p>
      <Select.Root
        type="single"
        value={fabricCanvas.arrowStartHead}
        onValueChange={(v) => { if (v) fabricCanvas.setArrowStartHead(v as ArrowHeadType); }}
      >
        <Select.Trigger size="sm" class="w-full justify-center px-1.5">
          <svg viewBox="0 0 16 16" class="size-4 shrink-0" fill="none">
            {@html icons.start[fabricCanvas.arrowStartHead]}
          </svg>
        </Select.Trigger>
        <Select.Content>
          {#each headTypes as ht}
            <Select.Item value={ht.value} label={ht.label}>
              <svg viewBox="0 0 16 16" class="size-4 shrink-0" fill="none">
                {@html icons.start[ht.value]}
              </svg>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    <!-- End head -->
    <div class="flex flex-1 flex-col gap-1">
      <p class="text-xs text-muted-foreground/70">End</p>
      <Select.Root
        type="single"
        value={fabricCanvas.arrowEndHead}
        onValueChange={(v) => { if (v) fabricCanvas.setArrowEndHead(v as ArrowHeadType); }}
      >
        <Select.Trigger size="sm" class="w-full justify-center px-1.5">
          <svg viewBox="0 0 16 16" class="size-4 shrink-0" fill="none">
            {@html icons.end[fabricCanvas.arrowEndHead]}
          </svg>
        </Select.Trigger>
        <Select.Content>
          {#each headTypes as ht}
            <Select.Item value={ht.value} label={ht.label}>
              <svg viewBox="0 0 16 16" class="size-4 shrink-0" fill="none">
                {@html icons.end[ht.value]}
              </svg>
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

  </div>
</div>
