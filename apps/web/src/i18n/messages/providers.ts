import { defineMessages } from "../define.ts";

export const providers = defineMessages(
  {
    "prov.add": "Add model provider",
    "prov.empty": "No model provider yet. Add one to see its models and choose which ones to offer.",
    "prov.prompt.exampleCurl":
      'curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \\\n  -H \'x-goog-api-key: YOUR_API_KEY\' \\\n  -H \'Content-Type: application/json\' \\\n  -X POST -d \'{"contents":[{"parts":[{"text":"Hello"}]}]}\'',
    "prov.removeBodyOne":
      "1 model from {name} is deleted with it, including its price and per-organization settings. Conversation and usage history are kept.",
    "prov.removeBodyModels":
      "{count} models from {name} are deleted with it, including their prices and per-organization settings. Conversation and usage history are kept.",
    "prov.models.disconnected":
      "{name} isn't connected, so its models are kept but unavailable until it is connected again.",
    "prov.billing.label": "This account is on a paid plan (billing is on)",
    "prov.billing.help":
      "On a free plan the provider may use prompts and replies to improve its products and a person may read them. Orbs only lets people chat with models of a provider you confirm is on a paid plan.",
    "prov.billing.needed": "Billing isn't confirmed, so these models can't be used for chat yet.",
    "prov.models.title": "Available models",
    "prov.models.count": "{active} active of {total}",
    "prov.models.onlyActive": "Only active",
    "prov.models.filter": "Filter models",
    "prov.models.empty": "No models match.",
    "prov.models.loading": "Checking which of the provider's models work for this key…",
    "prov.models.refused":
      "The provider no longer serves this model to your project. Switch it off and use another one.",
    "prov.models.colActive": "Active",
    "prov.models.colEnabled": "Enabled",
    "prov.models.legend":
      "Active puts a model in the model lists. Enabled lets people choose it; a model that is active but not enabled is shown greyed out.",
    "prov.models.limits": "Input {input} tokens · output {output} tokens",
    "pa.billingHint":
      "One more step: models of this provider can't be used for chat until you confirm the account is on a paid plan (a free plan may let the provider read prompts). Use the switch on the provider's row once you've checked.",
    "pa.greeting":
      "Tell me what you'd like to do and I'll ask for whatever I need. You can send the suggestion below as it is.",
    "pa.suggestion":
      "/add-new-model-provider Help me add a new model provider. Start by asking for its name and connection details.",
    "pa.ask.provider": "Which provider do you want to add? I can connect: {supported}.",
    "pa.ask.unknownProvider": "I don't support that provider yet. I can connect: {supported}.",
    "pa.ask.key":
      "Paste the API key for {provider}. You can also paste the curl command from Google AI Studio (“Get code”) and I'll find the key in it. I keep only the key, encrypted.",
    "pa.ask.noKey":
      "I couldn't find an API key in that. Paste the key (it starts with AIza…) or the curl command.",
    "pa.ask.placeholderKey": "That is still the example text. Paste your real API key.",
    "pa.ask.labels":
      "Got it. Optional: how should I label it? You can give a name, a project name and a project number, or say “skip”.",
    "pa.ask.ready": "Connecting to {provider}…",
    "pa.connected": "Connected to {provider}{name}. Open it to choose which models are active.",
    "pa.failed": "{provider} rejected the key: {error}\nPaste another key to try again.",
    "pa.send": "Send",
    "pa.connecting": "Connecting…",
    "pa.done": "Done",
    "pa.inputLabel": "Your message",
    "pa.hint": "Enter to send · Shift+Enter for a new line",
    "pa.privacy": "The key is hidden here and stored encrypted.",
    "prov.usageMonth": "This month: {usd} ({idr}) · {tokens} tokens · {people} people",
    "prov.usageNone": "No usage this month yet.",
    "prov.title": "Model providers",
    "prov.desc":
      "Connect the AI providers this installation can use. Keys are encrypted on the server and never shown again. Status is re-checked with the provider every 30 seconds.",
    "prov.vaultMissing":
      "No encryption key is set. Add ORBS_SECRET_KEY (32 bytes, base64) to the server environment and restart before saving credentials.",
    "prov.status.connected": "Connected",
    "prov.status.failed": "Connection failed",
    "prov.status.notConfigured": "Not connected",
    "prov.status.checking": "Checking connections…",
    "prov.checked": "Checked {date}",
    "prov.saving": "Connecting…",
    "prov.connect": "Connect",
    "prov.replace": "Replace credentials",
    "prov.diagnose": "Check endpoints and models",
    "prov.diagnosing": "Checking every endpoint…",
    "prov.endpoints.title": "Endpoints",
    "prov.endpoints.summary": "{ok} of {total} reachable",
    "prov.endpoints.failed": "{count} failed",
    "prov.endpoints.skipped": "{count} skipped",
    "prov.test": "Test connection",
    "prov.testing": "Testing…",
    "prov.remove": "Remove",
    "prov.removeTitle": "Remove {name} credentials?",
    "prov.removeBody":
      "The stored key is deleted. Models from this provider stop working until you add a key again.",
    "prov.testOk": "Test passed: the provider accepted the stored key.",
    "prov.testFailed": "Test failed: {error}",
    "prov.savedFailed": "Saved, but the provider rejected the key: {error}",
  },
  {
    "prov.add": "Tambah penyedia model",
    "prov.empty":
      "Belum ada penyedia model. Tambahkan satu untuk melihat modelnya dan memilih mana yang ditawarkan.",
    "prov.prompt.exampleCurl":
      'curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent" \\\n  -H \'x-goog-api-key: YOUR_API_KEY\' \\\n  -H \'Content-Type: application/json\' \\\n  -X POST -d \'{"contents":[{"parts":[{"text":"Halo"}]}]}\'',
    "prov.removeBodyOne":
      "1 model dari {name} ikut dihapus, termasuk harga dan pengaturan per organisasinya. Riwayat percakapan dan penggunaan tetap disimpan.",
    "prov.removeBodyModels":
      "{count} model dari {name} ikut dihapus, termasuk harga dan pengaturan per organisasinya. Riwayat percakapan dan penggunaan tetap disimpan.",
    "prov.models.disconnected":
      "{name} tidak tersambung, jadi modelnya disimpan tetapi tidak tersedia sampai tersambung lagi.",
    "prov.billing.label": "Akun ini memakai paket berbayar (tagihan aktif)",
    "prov.billing.help":
      "Di paket gratis, penyedia boleh memakai prompt dan jawaban untuk meningkatkan produknya dan seseorang bisa membacanya. Orbs hanya mengizinkan chat dengan model dari penyedia yang kamu konfirmasi memakai paket berbayar.",
    "prov.billing.needed": "Tagihan belum dikonfirmasi, jadi model ini belum bisa dipakai untuk chat.",
    "prov.models.title": "Model tersedia",
    "prov.models.count": "{active} aktif dari {total}",
    "prov.models.onlyActive": "Hanya yang aktif",
    "prov.models.filter": "Saring model",
    "prov.models.empty": "Tidak ada model yang cocok.",
    "prov.models.loading": "Memeriksa model penyedia mana yang bisa dipakai dengan key ini…",
    "prov.models.refused":
      "Penyedia tidak lagi melayani model ini untuk proyekmu. Matikan dan pakai model lain.",
    "prov.models.colActive": "Aktif",
    "prov.models.colEnabled": "Enable",
    "prov.models.legend":
      "Aktif memasukkan model ke daftar model. Enable membuatnya bisa dipilih; model yang aktif tetapi tidak di-enable tampil redup.",
    "prov.models.limits": "Input {input} token · output {output} token",
    "pa.billingHint":
      "Satu langkah lagi: model penyedia ini belum bisa dipakai untuk chat sampai kamu mengonfirmasi akun memakai paket berbayar (paket gratis bisa membuat penyedia membaca prompt). Gunakan sakelar di baris penyedia setelah kamu memeriksanya.",
    "pa.greeting":
      "Ceritakan apa yang ingin kamu lakukan dan aku akan menanyakan apa yang kubutuhkan. Kamu bisa mengirim saran di bawah apa adanya.",
    "pa.suggestion":
      "/add-new-model-provider Bantu aku menambahkan penyedia model baru. Mulai dengan menanyakan nama dan detail koneksinya.",
    "pa.ask.provider": "Penyedia mana yang ingin kamu tambahkan? Yang bisa kuhubungkan: {supported}.",
    "pa.ask.unknownProvider": "Penyedia itu belum didukung. Yang bisa kuhubungkan: {supported}.",
    "pa.ask.key":
      "Tempel API key untuk {provider}. Kamu juga bisa menempel perintah curl dari Google AI Studio (“Get code”) dan aku akan mencari key-nya. Hanya key yang kusimpan, terenkripsi.",
    "pa.ask.noKey": "Aku tidak menemukan API key di situ. Tempel key-nya (diawali AIza…) atau perintah curl.",
    "pa.ask.placeholderKey": "Itu masih teks contoh. Tempel API key aslimu.",
    "pa.ask.labels":
      "Oke. Opsional: mau diberi label apa? Kamu bisa menyebut nama, nama proyek, dan nomor proyek, atau bilang “lewati”.",
    "pa.ask.ready": "Menghubungkan ke {provider}…",
    "pa.connected": "Terhubung ke {provider}{name}. Buka untuk memilih model mana yang aktif.",
    "pa.failed": "{provider} menolak key itu: {error}\nTempel key lain untuk mencoba lagi.",
    "pa.send": "Kirim",
    "pa.connecting": "Menghubungkan…",
    "pa.done": "Selesai",
    "pa.inputLabel": "Pesanmu",
    "pa.hint": "Enter untuk kirim · Shift+Enter untuk baris baru",
    "pa.privacy": "Key disembunyikan di sini dan disimpan terenkripsi.",
    "prov.usageMonth": "Bulan ini: {usd} ({idr}) · {tokens} token · {people} orang",
    "prov.usageNone": "Belum ada penggunaan bulan ini.",
    "prov.title": "Penyedia model",
    "prov.desc":
      "Hubungkan penyedia AI yang bisa dipakai instalasi ini. Key dienkripsi di server dan tidak pernah ditampilkan lagi. Status diperiksa ulang ke penyedia setiap 30 detik.",
    "prov.vaultMissing":
      "Kunci enkripsi belum diatur. Tambahkan ORBS_SECRET_KEY (32 byte, base64) ke environment server dan restart sebelum menyimpan kredensial.",
    "prov.status.connected": "Terhubung",
    "prov.status.failed": "Koneksi gagal",
    "prov.status.notConfigured": "Belum terhubung",
    "prov.status.checking": "Memeriksa koneksi…",
    "prov.checked": "Dicek {date}",
    "prov.saving": "Menghubungkan…",
    "prov.connect": "Hubungkan",
    "prov.replace": "Ganti kredensial",
    "prov.diagnose": "Periksa endpoint dan model",
    "prov.diagnosing": "Memeriksa setiap endpoint…",
    "prov.endpoints.title": "Endpoint",
    "prov.endpoints.summary": "{ok} dari {total} terjangkau",
    "prov.endpoints.failed": "{count} gagal",
    "prov.endpoints.skipped": "{count} dilewati",
    "prov.test": "Tes koneksi",
    "prov.testing": "Menguji…",
    "prov.remove": "Hapus",
    "prov.removeTitle": "Hapus kredensial {name}?",
    "prov.removeBody":
      "Key yang tersimpan dihapus. Model dari penyedia ini berhenti bekerja sampai kamu menambahkan key lagi.",
    "prov.testOk": "Tes berhasil: penyedia menerima key yang tersimpan.",
    "prov.testFailed": "Tes gagal: {error}",
    "prov.savedFailed": "Tersimpan, tetapi penyedia menolak key: {error}",
  },
);
