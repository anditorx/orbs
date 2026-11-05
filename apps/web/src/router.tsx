import { isSystemAdmin } from "@orbs/protocol";
import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { useT } from "./i18n/index.ts";
import { authClient } from "./lib/auth.ts";
import { AdminPage } from "./routes/AdminPage.tsx";
import { AppShell } from "./routes/AppShell.tsx";
import { AuthPage } from "./routes/AuthPage.tsx";
import { CodeMode } from "./routes/CodeMode.tsx";
import { CUSTOMIZE_SECTIONS, CustomizePage } from "./routes/CustomizePage.tsx";
import { InvitePage } from "./routes/InvitePage.tsx";
import { OnboardingPage } from "./routes/OnboardingPage.tsx";
import { SETTINGS_SECTIONS, SettingsPage } from "./routes/SettingsPage.tsx";
import { ThreadView } from "./routes/ThreadView.tsx";
import { UsagePage } from "./routes/UsagePage.tsx";
import { WorkHome } from "./routes/WorkHome.tsx";

async function currentSession() {
  const { data } = await authClient.getSession();
  return data;
}

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: AuthPage,
});

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding",
  beforeLoad: async () => {
    if (!(await currentSession())) throw redirect({ to: "/login" });
  },
  component: OnboardingPage,
});

/** Invitation link: works signed in or out (sign-up is allowed from a valid link). */
const inviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invite/$invitationId",
  component: InvitePage,
});

/** System administration: requires a system administrator, but no organization. */
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin",
  beforeLoad: async () => {
    const session = await currentSession();
    if (!session) throw redirect({ to: "/login" });
    if (!isSystemAdmin((session.user as { role?: string | null }).role)) throw redirect({ to: "/" });
  },
  component: AdminPage,
});

/** Signed-in area: requires a session and an active organization. */
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "app",
  beforeLoad: async () => {
    const session = await currentSession();
    if (!session) throw redirect({ to: "/login" });
    if (!session.session.activeOrganizationId) {
      const orgs = await authClient.organization.list();
      const first = orgs.data?.[0];
      if (!first) throw redirect({ to: "/onboarding" });
      await authClient.organization.setActive({ organizationId: first.id });
    }
  },
  component: AppShell,
});

const homeRoute = createRoute({ getParentRoute: () => appRoute, path: "/", component: WorkHome });
const threadRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/t/$threadId",
  component: ThreadView,
});
const codeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/code",
  validateSearch: (search: Record<string, unknown>): { project?: string; file?: string } => ({
    project: typeof search.project === "string" ? search.project : undefined,
    file: typeof search.file === "string" ? search.file : undefined,
  }),
  component: CodeMode,
});

const settingsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/settings/$section",
  beforeLoad: ({ params }) => {
    if (!SETTINGS_SECTIONS.some((s) => s.id === params.section)) {
      throw redirect({ to: "/settings/$section", params: { section: "appearance" } });
    }
  },
  component: SettingsPage,
});

const usageRoute = createRoute({ getParentRoute: () => appRoute, path: "/usage", component: UsagePage });

const customizeRoute = createRoute({
  getParentRoute: () => appRoute,
  path: "/customize/$section",
  beforeLoad: ({ params }) => {
    if (!CUSTOMIZE_SECTIONS.some((s) => s.id === params.section)) {
      throw redirect({ to: "/customize/$section", params: { section: "skills" } });
    }
  },
  component: CustomizePage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  onboardingRoute,
  inviteRoute,
  adminRoute,
  appRoute.addChildren([homeRoute, threadRoute, codeRoute, settingsRoute, customizeRoute, usageRoute]),
]);

function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const t = useT();
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <p className="font-medium">{t("error.title")}</p>
        <p className="text-sm text-muted-foreground">
          {t("error.body", { reason: error instanceof Error ? error.message : t("error.unreachable") })}
        </p>
        <button
          type="button"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          {t("common.tryAgain")}
        </button>
      </div>
    </div>
  );
}

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultErrorComponent: RouteError,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
