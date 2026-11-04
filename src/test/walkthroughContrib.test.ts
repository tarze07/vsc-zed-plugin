import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of `contributes.walkthroughs` (#12): every step has existing media and every
 * `command:` link / completion event refers to something the extension (or VS Code) provides.
 * No `vscode` import — runs with plain mocha.
 */

const ROOT = path.resolve(__dirname, '../..');
const WALKTHROUGH_ID = 'zedLayout.gettingStarted';

interface Media {
  markdown?: string;
  image?: unknown;
  svg?: string;
  altText?: string;
}

interface Step {
  id: string;
  title: string;
  description: string;
  media: Media;
  completionEvents?: string[];
}

interface Walkthrough {
  id: string;
  title: string;
  description: string;
  when?: string;
  steps: Step[];
}

interface PackageJson {
  contributes: {
    commands: { command: string }[];
    configuration: { properties: Record<string, unknown> };
    views: Record<string, { id: string }[]>;
    viewsContainers?: Record<string, { id: string }[]>;
    walkthroughs: Walkthrough[];
  };
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as PackageJson;

/** Built-in VS Code commands the walkthrough may link to. */
const BUILTIN_COMMANDS = new Set([
  'workbench.action.selectTheme',
  'workbench.action.openSettings',
  'workbench.action.openGlobalKeybindings',
  'workbench.action.moveView',
]);
/** Built-in settings the walkthrough may listen to. */
const BUILTIN_SETTINGS = new Set(['workbench.colorTheme']);

const declaredCommands = new Set(pkg.contributes.commands.map((c) => c.command));
const declaredSettings = new Set(Object.keys(pkg.contributes.configuration.properties));
const declaredViews = new Set(
  Object.values(pkg.contributes.views)
    .flat()
    .map((v) => v.id),
);
const viewContainerCommands = new Set(
  Object.values(pkg.contributes.viewsContainers ?? {})
    .flat()
    .map((c) => `workbench.view.extension.${c.id}`),
);

function isKnownCommand(id: string): boolean {
  return declaredCommands.has(id) || BUILTIN_COMMANDS.has(id) || viewContainerCommands.has(id);
}

/** `(command:id?args)` links in markdown; returns `{ id, args }`. */
function commandLinks(markdown: string): { id: string; args?: string }[] {
  const links: { id: string; args?: string }[] = [];
  for (const match of markdown.matchAll(/\(command:([\w.-]+)(?:\?([^)\s]*))?\)/g)) {
    links.push({ id: match[1], args: match[2] });
  }
  return links;
}

function walkthrough(): Walkthrough {
  const found = pkg.contributes.walkthroughs.find((w) => w.id === WALKTHROUGH_ID);
  assert.ok(found, `walkthrough ${WALKTHROUGH_ID} is contributed`);
  return found;
}

function mediaMarkdown(step: Step): string {
  assert.ok(step.media.markdown, `step ${step.id} uses markdown media`);
  return fs.readFileSync(path.join(ROOT, step.media.markdown), 'utf8');
}

suite('Walkthrough contribution', () => {
  test('getting started walkthrough exists and is shown without a when clause', () => {
    const w = walkthrough();
    assert.strictEqual(w.title, 'Get started with Zed-like Agent Workspace');
    assert.ok(w.description.length > 0);
    assert.strictEqual(w.when, undefined);
  });

  test('has the expected steps in order with unique ids', () => {
    const ids = walkthrough().steps.map((s) => s.id);
    assert.deepStrictEqual(ids, [
      'applyLayout',
      'chooseTheme',
      'configureAgents',
      'startSession',
      'reviewChanges',
      'keyboard',
    ]);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  test('every step has a title, description, completion events and existing media', () => {
    for (const step of walkthrough().steps) {
      assert.ok(step.title, `${step.id}: title`);
      assert.ok(step.description, `${step.id}: description`);
      assert.ok(step.completionEvents && step.completionEvents.length > 0, `${step.id}: events`);
      const file = step.media.markdown;
      assert.ok(file && file.startsWith('walkthrough/'), `${step.id}: media under walkthrough/`);
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${step.id}: ${file} exists`);
    }
  });

  test('images referenced from step markdown exist and are small', () => {
    for (const step of walkthrough().steps) {
      const dir = path.dirname(path.join(ROOT, step.media.markdown ?? ''));
      for (const match of mediaMarkdown(step).matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const image = path.join(dir, match[1]);
        assert.ok(fs.existsSync(image), `${step.id}: image ${match[1]} exists`);
        assert.ok(fs.statSync(image).size < 50_000, `${step.id}: image ${match[1]} is small`);
      }
    }
  });

  test('every step description has a command button', () => {
    for (const step of walkthrough().steps) {
      assert.ok(commandLinks(step.description).length > 0, `${step.id}: has a command link`);
    }
  });

  test('command links in descriptions and media refer to known commands', () => {
    for (const step of walkthrough().steps) {
      const links = [...commandLinks(step.description), ...commandLinks(mediaMarkdown(step))];
      for (const link of links) {
        assert.ok(isKnownCommand(link.id), `${step.id}: unknown command ${link.id}`);
        if (link.args !== undefined) {
          const args: unknown = JSON.parse(decodeURIComponent(link.args));
          assert.ok(Array.isArray(args), `${step.id}: ${link.id} args are a JSON array`);
          if (link.id === 'workbench.action.openSettings') {
            const query = String(args[0]);
            assert.ok(
              [...declaredSettings].some((s) => s === query || s.startsWith(`${query}.`)),
              `${step.id}: settings query ${query} matches a declared setting`,
            );
          }
        }
      }
    }
  });

  test('completion events reference declared commands, settings and views', () => {
    for (const step of walkthrough().steps) {
      for (const event of step.completionEvents ?? []) {
        const [kind, ...rest] = event.split(':');
        const target = rest.join(':');
        switch (kind) {
          case 'onCommand':
            assert.ok(isKnownCommand(target), `${step.id}: unknown command ${target}`);
            break;
          case 'onSettingChanged':
            assert.ok(
              declaredSettings.has(target) || BUILTIN_SETTINGS.has(target),
              `${step.id}: unknown setting ${target}`,
            );
            break;
          case 'onView':
            assert.ok(declaredViews.has(target), `${step.id}: unknown view ${target}`);
            break;
          default:
            assert.fail(`${step.id}: unexpected completion event ${event}`);
        }
      }
    }
  });

  test('agent defaults described in the walkthrough match zedLayout.agents', () => {
    const agents = (
      pkg.contributes.configuration.properties['zedLayout.agents'] as {
        default: { label: string; command: string }[];
      }
    ).default;
    const step = walkthrough().steps.find((s) => s.id === 'configureAgents');
    assert.ok(step);
    const text = step.description + mediaMarkdown(step);
    for (const agent of agents) {
      assert.ok(text.includes(agent.label), `mentions ${agent.label}`);
      assert.ok(text.includes(agent.command), `mentions ${agent.command}`);
    }
  });
});
