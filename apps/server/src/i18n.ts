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
    "engine.noModels":
      "No model has been added for this organization yet. Ask a system administrator to add one.",
    "engine.noneUsable":
      "None of the models can be used yet. Each one is waiting for something (a connection, billing confirmation, a price or being enabled); the reasons are listed below.",
    "engine.globalOff": "Disabled system-wide by an administrator.",
    "engine.providerOff": "Its provider isn't connected right now.",
    "engine.billingOff": "An administrator hasn't confirmed that the provider account is on a paid plan.",
    "engine.unpricedOff": "An administrator hasn't set its price yet.",
    "turn.busy": "Orbs is still answering the previous message. Wait for it or stop it first.",
    "turn.rateLimited": "You are sending messages too fast. Try again in a moment.",
    "engine.orgOff": "Disabled for this organization by an administrator.",
    "engine.notAvailable": "That model isn't available for this organization.",
    "model.exists": "That model is already registered.",
    "model.priceBelowInput":
      "The input price can't be lower than the provider's price ({min} per 1M tokens), or using this model would cost more than it brings in.",
    "model.priceBelowOutput":
      "The output price can't be lower than the provider's price ({min} per 1M tokens), or using this model would cost more than it brings in.",
    "connector.vault_missing":
      "This installation has no encryption key (ORBS_SECRET_KEY), so connections can't be stored securely. Ask a system administrator.",
    "connector.not_configured":
      "This service isn't set up yet. Ask a system administrator to add its OAuth app.",
    "connector.unknown_provider": "Unknown service.",
    "connector.state_invalid": "The sign-in link is invalid or was already used. Start again.",
    "connector.state_expired": "The sign-in took too long. Start again.",
    "connector.wrong_user": "That sign-in was started by someone else. Start again from your own account.",
    "connector.denied": "Access was not granted.",
    "connector.issuer_mismatch":
      "The response came from an unexpected authorization server and was rejected.",
    "connector.exchange_failed":
      "The service refused to complete the sign-in. Check the app's client ID, secret and redirect URI.",
    "connector.needs_reauth": "The connection expired or was revoked. Connect again.",
    "connector.secret_required": "Enter the client secret for this client ID.",
    "connector.workspace_required": "Choose at least one workspace.",
    "connector.token_rejected":
      "The service refused this token. Check that it is copied completely and still valid.",
    "connector.tool_blocked": "Orbs doesn't allow that action for this service.",
    "connector.not_connected": "You haven't connected this service yet.",
    "connector.upstream": "The service didn't respond as expected. Try again later.",
    "provider.vault_missing":
      "This installation has no encryption key (ORBS_SECRET_KEY), so credentials can't be stored securely.",
    "provider.unknown_provider": "Unknown provider.",
    "provider.key_required": "Enter the API key.",
    "provider.not_configured": "This provider has no credentials yet.",
    "provider.key_unreadable": "The stored key can't be read. Enter it again.",
    "provider.activate_first": "Make the model active before enabling it.",
    "provider.model_not_offered": "This provider's key doesn't offer that model.",
    "provider.provider_unreachable":
      "Couldn't read the model list from the provider. Check the connection and try again.",
    "connector.rate_limited": "You're making requests too quickly. Wait a moment and try again.",
    "connector.unsafe_url": "That address can't be used. It must be a public https address.",
    "connector.limit_reached": "You've reached the limit of 10 custom servers. Remove one first.",
    "connector.name_taken": "You already have a server with that name.",
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
    "engine.noModels":
      "Belum ada model yang ditambahkan untuk organisasi ini. Minta administrator sistem menambahkannya.",
    "engine.noneUsable":
      "Belum ada model yang bisa dipakai. Masing-masing masih menunggu sesuatu (sambungan, konfirmasi tagihan, harga, atau diaktifkan); alasannya tertera di bawah.",
    "engine.globalOff": "Dinonaktifkan di seluruh sistem oleh administrator.",
    "engine.providerOff": "Penyedianya sedang tidak tersambung.",
    "engine.billingOff": "Administrator belum mengonfirmasi bahwa akun penyedia memakai paket berbayar.",
    "engine.unpricedOff": "Administrator belum mengisi harganya.",
    "turn.busy": "Orbs masih menjawab pesan sebelumnya. Tunggu atau hentikan dulu.",
    "turn.rateLimited": "Kamu mengirim pesan terlalu cepat. Coba lagi sebentar lagi.",
    "engine.orgOff": "Dinonaktifkan untuk organisasi ini oleh administrator.",
    "engine.notAvailable": "Model itu tidak tersedia untuk organisasi ini.",
    "model.exists": "Model itu sudah terdaftar.",
    "model.priceBelowInput":
      "Harga input tidak boleh lebih rendah dari harga penyedia ({min} per 1 juta token), kalau tidak memakai model ini lebih mahal daripada pemasukannya.",
    "model.priceBelowOutput":
      "Harga output tidak boleh lebih rendah dari harga penyedia ({min} per 1 juta token), kalau tidak memakai model ini lebih mahal daripada pemasukannya.",
    "connector.vault_missing":
      "Instalasi ini belum punya kunci enkripsi (ORBS_SECRET_KEY), jadi koneksi tidak bisa disimpan dengan aman. Hubungi administrator sistem.",
    "connector.not_configured":
      "Layanan ini belum disiapkan. Minta administrator sistem menambahkan aplikasi OAuth-nya.",
    "connector.unknown_provider": "Layanan tidak dikenal.",
    "connector.state_invalid": "Tautan masuk tidak valid atau sudah dipakai. Mulai lagi.",
    "connector.state_expired": "Proses masuk terlalu lama. Mulai lagi.",
    "connector.wrong_user": "Proses masuk itu dimulai oleh orang lain. Mulai lagi dari akunmu sendiri.",
    "connector.denied": "Akses tidak diberikan.",
    "connector.issuer_mismatch": "Respons datang dari server otorisasi yang tidak dikenal dan ditolak.",
    "connector.exchange_failed":
      "Layanan menolak menyelesaikan proses masuk. Periksa client ID, secret, dan redirect URI aplikasinya.",
    "connector.needs_reauth": "Koneksi sudah kedaluwarsa atau dicabut. Hubungkan lagi.",
    "connector.secret_required": "Masukkan client secret untuk client ID ini.",
    "connector.workspace_required": "Pilih setidaknya satu ruang kerja.",
    "connector.token_rejected": "Layanan menolak token ini. Pastikan tersalin lengkap dan masih berlaku.",
    "connector.tool_blocked": "Orbs tidak mengizinkan tindakan itu untuk layanan ini.",
    "connector.not_connected": "Kamu belum menghubungkan layanan ini.",
    "connector.upstream": "Layanan tidak merespons seperti seharusnya. Coba lagi nanti.",
    "provider.vault_missing":
      "Instalasi ini belum punya kunci enkripsi (ORBS_SECRET_KEY), jadi kredensial tidak bisa disimpan dengan aman.",
    "provider.unknown_provider": "Penyedia tidak dikenal.",
    "provider.key_required": "Masukkan API key.",
    "provider.not_configured": "Penyedia ini belum punya kredensial.",
    "provider.key_unreadable": "Key yang tersimpan tidak bisa dibaca. Masukkan lagi.",
    "provider.activate_first": "Aktifkan model dulu sebelum meng-enable-nya.",
    "provider.model_not_offered": "Key penyedia ini tidak menawarkan model itu.",
    "provider.provider_unreachable":
      "Daftar model dari penyedia tidak bisa dibaca. Periksa koneksi lalu coba lagi.",
    "connector.rate_limited": "Permintaanmu terlalu cepat. Tunggu sebentar lalu coba lagi.",
    "connector.unsafe_url": "Alamat itu tidak bisa dipakai. Harus berupa alamat https publik.",
    "connector.limit_reached": "Kamu sudah mencapai batas 10 server kustom. Hapus salah satu dulu.",
    "connector.name_taken": "Kamu sudah punya server dengan nama itu.",
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
