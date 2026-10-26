export function fakeChrome() {
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const granted = new Set<string>();
  const injected: { tabId: number; files: string[]; allFrames?: boolean }[] = [];
  const alarmNames: string[] = [];
  const tabs = { id: 1, url: "https://app.test/form", title: "Form" };
  return {
    injected,
    granted,
    alarms: alarmNames,
    storage: {
      local: {
        get: async (keys?: string | string[]) => (typeof keys === "string" ? { [keys]: local[keys] } : { ...local }),
        set: async (v: Record<string, unknown>) => void Object.assign(local, v),
      },
      session: {
        get: async () => ({ ...session }),
        set: async (v: Record<string, unknown>) => void Object.assign(session, v),
      },
    },
    tabs: { query: async () => [tabs], get: async () => tabs },
    permissions: {
      request: async ({ origins }: { origins: string[] }) => {
        origins.forEach((o) => granted.add(o));
        return true;
      },
      contains: async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o)),
    },
    scripting: {
      executeScript: async (opts: { target: { tabId: number; allFrames?: boolean }; files: string[] }) => {
        injected.push({ tabId: opts.target.tabId, files: opts.files, allFrames: opts.target.allFrames });
      },
    },
    alarmApi: {
      create: async (name: string) => {
        alarmNames.push(name);
      },
      clear: async (name: string) => {
        const i = alarmNames.indexOf(name);
        if (i >= 0) alarmNames.splice(i, 1);
        return i >= 0;
      },
    },
    action: { setBadgeText: async () => undefined, setBadgeBackgroundColor: async () => undefined, setTitle: async () => undefined },
  };
}
