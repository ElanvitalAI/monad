import { describe, expect, test } from 'bun:test';
import { stripAnsi } from '../src/tui.js';
import { Printer } from '../src/ui/printer.js';
import {
  buildIulOptionPreviewTail,
  createIulOptionLaneView,
} from '../src/iul/lane-select-view.js';

function render(view: ReturnType<typeof createIulOptionLaneView>): string {
  view.layout({ width: 84, height: 28 });
  const printer = Printer.create({ width: 84, height: 28, focused: true });
  view.draw(printer);
  return printer.lines().map(stripAnsi).join('\n');
}

describe('IUL lane select view', () => {
  test('builds goal / observe / next preview tails with optional last-picked feedback', () => {
    const tail = buildIulOptionPreviewTail({
      id: 'modal-shells',
      label: 'Modal Shells',
      description: 'Compare modal shells',
      goal: 'Choose the best shell for interruptive flows.',
      observe: 'Watch title density and footer rhythm.',
      nextStep: 'Attach real modal recipes.',
    }, 'Use this lane to compare popup families.', 'Modal Shells');
    expect(tail).toContain('Goal: Choose the best shell for interruptive flows.');
    expect(tail).toContain('Observe: Watch title density and footer rhythm.');
    expect(tail).toContain('Next: Attach real modal recipes.');
    expect(tail).toContain('Last picked: Modal Shells');
  });

  test('records last picked option into preview tail after submit', () => {
    const view = createIulOptionLaneView({
      title: 'Popup lab',
      footerHint: 'browse popup lanes',
      previewTail: 'Use this lane to compare popup families.',
      entries: [
        {
          id: 'modal-shells',
          label: 'Modal Shells',
          description: 'Compare modal shells',
          goal: 'Choose the best shell for interruptive flows.',
          observe: 'Watch title density and footer rhythm.',
          nextStep: 'Attach real modal recipes.',
        },
        { id: 'picker-popups', label: 'Picker Popups', description: 'Compare picker popups' },
      ],
    });
    const initial = render(view);
    expect(initial).toContain('Goal: Choose the best shell');
    expect(initial).toContain('Observe: Watch title density');
    expect(initial).not.toContain('Last picked:');
    view.onEvent({ name: 'enter', ctrl: false, shift: false, alt: false });
    expect(buildIulOptionPreviewTail({
      id: 'modal-shells',
      label: 'Modal Shells',
      description: 'Compare modal shells',
      goal: 'Choose the best shell for interruptive flows.',
      observe: 'Watch title density and footer rhythm.',
      nextStep: 'Attach real modal recipes.',
    }, 'Use this lane to compare popup families.', 'Modal Shells')).toContain('Last picked: Modal Shells');
  });
});
