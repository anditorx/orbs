import { ORPCError } from "@orpc/server";
import { t } from "../i18n.ts";
import {
  checkProviders,
  diagnoseProvider,
  listProviderModels,
  listProviders,
  ProviderError,
  removeProvider,
  saveProvider,
  setBilling,
  setProviderModel,
  testProvider,
} from "../modelProviders.ts";
import { systemAdmin } from "./base.ts";

function fail(error: unknown): never {
  if (error instanceof ProviderError)
    throw new ORPCError(
      error.code === "unknown_provider" || error.code === "not_configured" ? "NOT_FOUND" : "BAD_REQUEST",
      {
        message: t(`provider.${error.code}` as Parameters<typeof t>[0]),
      },
    );
  throw error;
}

export const adminProvidersRouter = {
  list: systemAdmin.admin.providers.list.handler(() => listProviders()),
  check: systemAdmin.admin.providers.check.handler(() => checkProviders()),
  save: systemAdmin.admin.providers.save.handler(async ({ context, input }) => {
    try {
      return await saveProvider(context.user.id, input);
    } catch (error) {
      return fail(error);
    }
  }),
  test: systemAdmin.admin.providers.test.handler(async ({ context, input }) => {
    try {
      return await testProvider(context.user.id, input.provider);
    } catch (error) {
      return fail(error);
    }
  }),
  setModel: systemAdmin.admin.providers.setModel.handler(async ({ context, input }) => {
    try {
      await setProviderModel(context.user.id, input);
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  }),
  setBilling: systemAdmin.admin.providers.setBilling.handler(async ({ context, input }) => {
    try {
      await setBilling(context.user.id, input.provider, input.confirmed);
      return { ok: true as const };
    } catch (error) {
      return fail(error);
    }
  }),
  models: systemAdmin.admin.providers.models.handler(async ({ input }) => {
    try {
      return await listProviderModels(input.provider);
    } catch (error) {
      return fail(error);
    }
  }),
  diagnose: systemAdmin.admin.providers.diagnose.handler(async ({ context, input }) => {
    try {
      return await diagnoseProvider(context.user.id, input.provider);
    } catch (error) {
      return fail(error);
    }
  }),
  remove: systemAdmin.admin.providers.remove.handler(async ({ context, input }) => {
    try {
      const { modelsRemoved } = await removeProvider(context.user.id, input.provider);
      return { ok: true as const, modelsRemoved };
    } catch (error) {
      return fail(error);
    }
  }),
};
