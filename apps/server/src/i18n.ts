import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Server-side translation of user-facing messages (errors, engine descriptions).
 * The web app sends the chosen language in the `x-orbs-lang` header; a middleware stores it for the
 * duration of the request, so any code (handlers, auth hooks, helpers) can call `t()` without
 * threading the language through every function. English is the default.
 */
export type Lang = "en" | "id";
export const LANG_HEADER = "x-orbs-lang";

const storage = new AsyncLocalStorage<Lang>();

export function parseLang(value: string | null | undefined): Lang {
  return value === "id" ? "id" : "en";
}

export function runWithLang<T>(lang: Lang, fn: () => T): T {
  return storage.run(lang, fn);
}

export function currentLang(): Lang {
  return storage.getStore() ?? "en";
}

const messages = {
  en: {
    "auth.lastAdmin": "A workspace must keep at least one admin. Make another member an admin first.",
    "auth.unknownRole": "Unknown role. Choose Admin or Member.",
    "auth.banned": "Your account has been blocked by an administrator. Contact an admin for help.",
    "signup.inviteOnly":
      "Sign-up is only possible through an invitation link. Ask an admin to send you one for your email.",
    "signup.domain": "This email isn't allowed to sign up. Use your work email.",
    "http.blocked": "This action is disabled in Orbs.",
    "common.orgNotFound": "Organization not found",
    "common.userNotFound": "User not found",
    "common.memberNotFound": "Member not found",
    "common.projectNotFound": "Project not found",
    "common.threadNotFound": "Conversation not found",
    "common.noActiveOrg": "No active organization",
    "common.notMember": "You are not a member of this organization",
    "common.systemAdminOnly": "System administrators only",
    "common.adminOnly": "Workspace admins or system administrators only",
    "admin.cannotRevokeSelf": "You can't remove your own admin role.",
    "admin.needSystemAdmin": "There must be at least one system administrator.",
    "admin.nameMismatch": "The organization name doesn't match. Deletion cancelled.",
    "admin.alreadyMember": "This person is already a member.",
    "admin.emailTaken": "That email is already used by another account.",
    "admin.cannotDeleteSelf": "You can't delete your own account.",
    "custom.invalidJson": "The plugin body must be a valid JSON manifest",
    "custom.invalidManifest": "Invalid plugin manifest: {path} — {detail}",
    "custom.notFound": "Customization not found",
    "custom.orgCreateAdminOnly": "Only workspace admins can create items for the whole workspace",
    "custom.kindFixed": "An item's type can't be changed",
    "custom.shareAdminOnly": "Only workspace admins can share with the whole workspace",
    "custom.editOrgAdminOnly": "Only workspace admins can change workspace items",
    "custom.editOwnerOnly": "Only the owner can change this item",
    "project.codeOnly": "Only Code projects accept files",
    "project.invalidPath": "Invalid path",
    "project.fileNotFound": "File not found",
    "project.deleteForbidden": "Only the creator or an admin can delete this project",
    "project.renameForbidden": "Only the creator or an admin can rename this project",
    "thread.deleteForbidden": "Only the creator or an admin can delete this conversation",
    "usage.memberNotInOrg": "Member not found in this workspace",
    "usage.budgetNotFound": "Limit not found",
    "usage.exceeded":
      "Your monthly usage limit{where} has been reached. Ask a workspace admin to raise it or reset your quota.",
    "usage.exceededWhere": ' for project "{project}"',
    "engine.auto": "Automatic",
    "engine.autoDesc": "Orbs picks the most economical model that is good enough for each request.",
    "engine.noCatalog":
      "No model is enabled for this organization yet. Ask a system administrator to enable one.",
    "engine.globalOff": "Disabled system-wide by an administrator.",
    "engine.orgOff": "Disabled for this organization by an administrator.",
    "engine.notAvailable": "That model isn't available for this organization.",
    "model.exists": "That model is already registered.",
    "model.notFound": "Model not found",
    "engine.modelDesc": "{provider} · max data: {maxDataClass}",
    "engine.agentDesc": "External coding agent through a harness adapter (Code mode).",
    "engine.agentSoon": "Not available yet — planned for Phase 5.",
  },
  id: {
    "auth.lastAdmin": "Ruang kerja harus punya minimal satu admin. Jadikan anggota lain admin lebih dulu.",
    "auth.unknownRole": "Peran tidak dikenal. Pilih Admin atau Anggota.",
    "auth.banned": "Akun kamu diblokir oleh administrator. Hubungi admin untuk bantuan.",
    "signup.inviteOnly":
      "Pendaftaran hanya lewat tautan undangan. Minta admin mengirim tautan undangan untuk email kamu.",
    "signup.domain": "Email ini tidak diizinkan mendaftar. Gunakan email kantor kamu.",
    "http.blocked": "Tindakan ini dinonaktifkan di Orbs.",
    "common.orgNotFound": "Organisasi tidak ditemukan",
    "common.userNotFound": "Pengguna tidak ditemukan",
    "common.memberNotFound": "Anggota tidak ditemukan",
    "common.projectNotFound": "Proyek tidak ditemukan",
    "common.threadNotFound": "Percakapan tidak ditemukan",
    "common.noActiveOrg": "Tidak ada organisasi aktif",
    "common.notMember": "Kamu bukan anggota organisasi ini",
    "common.systemAdminOnly": "Khusus administrator sistem",
    "common.adminOnly": "Khusus admin ruang kerja atau admin sistem",
    "admin.cannotRevokeSelf": "Kamu tidak bisa mencabut peran admin dirimu sendiri.",
    "admin.needSystemAdmin": "Harus ada minimal satu administrator sistem.",
    "admin.nameMismatch": "Nama organisasi tidak cocok. Penghapusan dibatalkan.",
    "admin.alreadyMember": "Orang ini sudah menjadi anggota.",
    "admin.emailTaken": "Email itu sudah dipakai akun lain.",
    "admin.cannotDeleteSelf": "Kamu tidak bisa menghapus akunmu sendiri.",
    "custom.invalidJson": "Isi plugin harus berupa JSON manifest yang valid",
    "custom.invalidManifest": "Manifest plugin tidak valid: {path} — {detail}",
    "custom.notFound": "Kustomisasi tidak ditemukan",
    "custom.orgCreateAdminOnly": "Hanya admin ruang kerja yang bisa membuat item untuk seluruh ruang kerja",
    "custom.kindFixed": "Jenis item tidak bisa diubah",
    "custom.shareAdminOnly": "Hanya admin ruang kerja yang bisa membagikan ke seluruh ruang kerja",
    "custom.editOrgAdminOnly": "Hanya admin ruang kerja yang bisa mengubah item milik ruang kerja",
    "custom.editOwnerOnly": "Hanya pemilik yang bisa mengubah item ini",
    "project.codeOnly": "Hanya proyek Kode yang menerima file",
    "project.invalidPath": "Path tidak valid",
    "project.fileNotFound": "File tidak ditemukan",
    "project.deleteForbidden": "Hanya pembuat atau admin yang bisa menghapus proyek ini",
    "project.renameForbidden": "Hanya pembuat atau admin yang bisa mengganti nama proyek ini",
    "thread.deleteForbidden": "Hanya pembuat atau admin yang bisa menghapus percakapan ini",
    "usage.memberNotInOrg": "Anggota tidak ditemukan di ruang kerja ini",
    "usage.budgetNotFound": "Batas tidak ditemukan",
    "usage.exceeded":
      "Batas pemakaian bulanan{where} sudah habis. Hubungi admin ruang kerja untuk menambah atau mereset kuota.",
    "usage.exceededWhere": ' untuk proyek "{project}"',
    "engine.auto": "Otomatis",
    "engine.autoDesc": "Orbs memilih model yang paling hemat dan cukup pintar untuk tiap permintaan.",
    "engine.noCatalog":
      "Belum ada model yang aktif untuk organisasi ini. Minta administrator sistem mengaktifkannya.",
    "engine.globalOff": "Dinonaktifkan di seluruh sistem oleh administrator.",
    "engine.orgOff": "Dinonaktifkan untuk organisasi ini oleh administrator.",
    "engine.notAvailable": "Model itu tidak tersedia untuk organisasi ini.",
    "model.exists": "Model itu sudah terdaftar.",
    "model.notFound": "Model tidak ditemukan",
    "engine.modelDesc": "{provider} · data maks: {maxDataClass}",
    "engine.agentDesc": "Agent coding eksternal lewat harness adapter (mode Kode).",
    "engine.agentSoon": "Belum tersedia — direncanakan di Fase 5.",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type MessageKey = keyof (typeof messages)["en"];

/** Translates `key` into the language of the current request (English outside a request). */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const text: string = messages[currentLang()][key];
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}
