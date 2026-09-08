# Product Requirements Document (PRD)

## ProofPass

**Versi:** 0.1 — Buildathon MVP  
**Status:** Draft for implementation  
**Pemilik produk:** ProofPass team  
**Platform:** Responsive web application  
**Konteks:** Midnight Buildathon 2026

---

## 1. Ringkasan Produk

ProofPass adalah aplikasi credential privat yang memungkinkan pengguna membuktikan fakta tertentu tanpa membagikan seluruh data pribadi yang menjadi sumber fakta tersebut. Produk ini menghubungkan tiga aktor: **issuer** yang menerbitkan credential, **holder** yang menyimpan credential, dan **verifier** yang meminta bukti.

MVP berfokus pada satu alur end-to-end yang dapat didemokan: sebuah issuer menerbitkan credential kelulusan pelatihan, holder menerima credential, verifier meminta proof bahwa credential tersebut masih aktif, dan holder menyetujui pengungkapan atribut minimum. Jika credential sudah expired atau dicabut, verifier menerima hasil invalid.

Nilai produk terletak pada **data minimization** dan **consent yang eksplisit**. Verifier hanya memperoleh fakta yang diperlukan, bukan nama legal, sertifikat lengkap, alamat, atau atribut lain yang tidak berhubungan dengan tujuan verifikasi.

> **Product promise:** Prove the fact. Keep the rest private.

## 2. Masalah

Layanan digital sering meminta dokumen penuh ketika hanya membutuhkan satu fakta. Seseorang yang ingin membuktikan bahwa ia telah lulus pelatihan, memenuhi syarat program, atau memiliki akses tertentu biasanya harus mengunggah sertifikat, identitas, atau berkas lain yang memuat data berlebih.

Pola tersebut menciptakan empat masalah. Pertama, data yang tidak relevan ikut tersebar. Kedua, pengguna kehilangan kendali atas salinan dokumen. Ketiga, verifier harus menyimpan dan mengamankan data yang sebenarnya tidak dibutuhkan. Keempat, pemeriksaan manual sulit diaudit dan tidak selalu mendeteksi dokumen yang sudah dicabut.

## 3. Tujuan Produk

### 3.1 Tujuan utama

1. Menunjukkan alur credential privat yang nyata dari issuer sampai verifier.
2. Memungkinkan selective disclosure dengan consent yang dapat dipahami pengguna.
3. Menyediakan status credential yang dapat diverifikasi, termasuk expiration dan revocation.
4. Memiliki minimal satu Compact contract yang dapat dikompilasi dan dipanggil melalui frontend.
5. Menyediakan demo yang membandingkan pengiriman dokumen penuh dengan pengiriman proof minimum.

### 3.2 Bukan tujuan MVP

1. Menjadi sistem identitas nasional atau pengganti KYC.
2. Menyimpan dokumen legal sebagai sumber kebenaran publik.
3. Mendukung semua jenis credential dan semua bentuk zero-knowledge proof.
4. Menyediakan marketplace, billing, atau organisasi multi-tenant penuh.
5. Menjamin bahwa issuer dunia nyata selalu jujur. MVP hanya memverifikasi credential yang diterbitkan oleh issuer terdaftar.

## 4. Persona dan Jobs-to-be-Done

### 4.1 Issuer — Maya, program lead

Maya mengelola program pelatihan. Ia ingin menerbitkan credential digital kepada peserta dan dapat mencabut credential apabila terjadi kesalahan atau pelanggaran.

**Job:** “Ketika seseorang menyelesaikan program, saya ingin menerbitkan credential yang dapat diverifikasi tanpa harus mempublikasikan data peserta.”

### 4.2 Holder — Alice, peserta

Alice memiliki beberapa credential. Ia ingin mengetahui apa yang diminta verifier sebelum menyetujui proof. Ia tidak ingin mengirim sertifikat lengkap kepada setiap organisasi.

**Job:** “Ketika sebuah aplikasi meminta bukti, saya ingin membagikan informasi minimum dan tetap memiliki kontrol atas data saya.”

### 4.3 Verifier — Ben, admissions coordinator

Ben perlu memeriksa apakah kandidat memenuhi syarat. Ia membutuhkan jawaban valid atau invalid yang dapat diaudit, tetapi tidak ingin mengelola dokumen sensitif yang berlebih.

**Job:** “Ketika saya mengecek kelayakan, saya ingin menerima proof yang jelas, cepat, dan dapat ditelusuri tanpa menyimpan data yang tidak diperlukan.”

## 5. Prinsip Produk

| Prinsip | Implikasi desain |
|---|---|
| Minimum disclosure | Setiap request menyebutkan atribut minimum yang dibutuhkan. |
| Consent first | Holder melihat tujuan, atribut, dan masa berlaku sebelum menyetujui. |
| Private by default | Data credential tidak diasumsikan publik. |
| Verifiable status | Expiration dan revocation merupakan bagian dari status proof. |
| Explainable privacy | UI menjelaskan apa yang dibagikan dan apa yang tetap privat. |
| Honest demo | Status “connected”, “pending”, dan “demo mode” dibedakan secara jelas. |

## 6. Ruang Lingkup MVP

### 6.1 Must-have

| Fitur | Deskripsi | Kriteria penerimaan |
|---|---|---|
| Dashboard holder | Ringkasan credential aktif, proof request, dan privacy activity | Pengguna dapat melihat status tanpa membaca tabel panjang. |
| Credential detail | Detail issuer, tanggal terbit, tanggal berlaku, dan status | Data privat dan metadata publik dibedakan secara visual. |
| Proof request | Permintaan verifier dengan daftar atribut dan tujuan | Request menampilkan “what will be shared” sebelum approval. |
| Approval flow | Holder menyetujui atau menolak request | State pending, approved, rejected, dan expired tersedia. |
| Revocation state | Credential dapat ditandai revoked pada data demo | Verifier tidak dapat menganggap credential revoked sebagai valid. |
| Verifier activity | Riwayat proof yang diterbitkan | Setiap row memiliki status dan timestamp. |
| Network status | Informasi koneksi Midnight dan mode demo | Status tidak ambigu dan dapat dipahami pengguna non-teknis. |
| Responsive UI | Desktop, tablet, dan mobile | Tidak ada horizontal overflow pada breakpoint 375px. |
| Accessibility | Keyboard focus, contrast, label, dan semantic buttons | Alur utama dapat dijalankan dengan keyboard. |

### 6.2 Should-have untuk Wave 2

- Credential templates.
- Multi-attribute policy dengan operator AND/OR.
- Credential expiry yang dapat dikonfigurasi.
- Revocation registry on-chain.
- Verifier organization workspace.
- Export audit log tanpa atribut privat.

### 6.3 Could-have untuk Wave 3

- Invite link untuk verifier.
- Public issuer registry.
- Pilot dengan komunitas atau lembaga pelatihan.
- Wallet adapter yang lebih lengkap.
- Analytics adopsi tanpa personal data.

## 7. User Flows

### 7.1 Holder menyetujui proof

1. Holder membuka halaman Proof requests.
2. Holder memilih request dengan status Pending.
3. Sistem menampilkan verifier, tujuan, atribut yang diminta, dan expiry request.
4. Holder membuka detail “You will share”.
5. Holder melihat data yang tidak dibagikan.
6. Holder menekan Approve proof.
7. Sistem menampilkan state processing.
8. Sistem menampilkan proof berhasil dan timestamp.

### 7.2 Holder menolak proof

1. Holder membuka request pending.
2. Holder menekan Decline.
3. Sistem menampilkan alasan opsional.
4. Holder mengonfirmasi.
5. Request menjadi Declined dan tidak dapat dipakai verifier.

### 7.3 Verifier memeriksa proof

1. Verifier membuka request atau menerima proof ID.
2. Sistem memeriksa issuer, commitment, nonce, expiry, dan revocation state.
3. Sistem menampilkan status Verified atau Not verified.
4. Sistem menampilkan hanya atribut yang diizinkan oleh holder.

### 7.4 Issuer mencabut credential

1. Issuer membuka credential registry.
2. Issuer memilih credential.
3. Issuer menekan Revoke credential.
4. Sistem meminta alasan internal.
5. Setelah transaksi selesai, status berubah menjadi Revoked.
6. Proof baru untuk credential tersebut ditolak.

## 8. Informasi dan Status

| Status | Arti | Warna UI |
|---|---|---|
| Active | Credential valid dan belum expired | Teal / emerald |
| Pending | Menunggu persetujuan holder | Amber |
| Verified | Proof lulus pemeriksaan | Teal / emerald |
| Expiring soon | Credential akan segera berakhir | Amber |
| Revoked | Credential dicabut issuer | Rose |
| Declined | Holder menolak request | Slate |
| Processing | Transaksi sedang diproses | Violet |

Warna tidak boleh menjadi satu-satunya pembeda. Setiap status wajib memiliki label teks dan ikon yang bermakna.

## 9. Information Architecture

- **Overview**: ringkasan wallet, privacy score, credential aktif, dan aktivitas terbaru.
- **Credentials**: daftar credential, filter status, detail credential, dan revocation state.
- **Proof requests**: request pending, approved, declined, dan expired.
- **Activity**: jejak proof dan transaksi yang dapat dibagikan tanpa data privat.
- **Settings**: wallet, privacy defaults, notification, dan appearance.

Navigasi desktop menggunakan sidebar persisten. Navigasi mobile berubah menjadi header ringkas dengan menu drawer.

## 10. UX dan Visual Direction

UI menggunakan gaya **editorial security workspace**: latar off-white hangat, tinta navy pekat, aksen teal sebagai sinyal trust, dan coral sebagai aksen tindakan penting. Tipografi menggabungkan **DM Sans** untuk teks antarmuka dengan **Space Grotesk** untuk heading dan angka metrik.

Dasbor tidak menggunakan hero center-aligned generik. Komposisi utamanya memakai sidebar kiri, header kontekstual, kartu ringkasan asimetris, dan panel aktivitas. Surface memiliki radius 18–24px, shadow lembut, border tipis, serta pattern grid halus pada area hero.

Motion menggunakan transition 160–240ms, hover elevation ringan, dan entrance fade-up. Semua motion non-esensial harus dimatikan ketika `prefers-reduced-motion: reduce` aktif.

## 11. Non-Functional Requirements

### Performance

- First meaningful render tetap ringan tanpa asset besar.
- Tidak menggunakan gambar dekoratif eksternal untuk komponen inti.
- Interaksi tab dan filter terasa instan.

### Accessibility

- Kontras teks utama minimal WCAG AA.
- Semua button mempunyai accessible name.
- Focus ring terlihat.
- Heading hierarchy hanya satu H1 per halaman.
- Target sentuh minimal 44px pada mobile.

### Security posture

- Jangan menampilkan private attributes pada public activity.
- Pisahkan data public metadata dan private payload pada contract model.
- Hindari menyimpan raw personal data di ledger.
- Jangan klaim “anonymous” jika data masih dapat dikorelasikan.

### Reliability

- Error state tersedia untuk wallet disconnected, transaction failed, dan expired request.
- State UI harus dapat direfresh tanpa kehilangan konteks.
- Semua destructive action memiliki confirmation.

## 12. Success Metrics

| Metric | Target MVP |
|---|---:|
| Demo completion rate | 100% untuk alur issuer → holder → verifier |
| Main flow completion | ≥ 90% pada usability test internal |
| Median approval time | < 30 detik untuk request sederhana |
| Test coverage kontrak | Semua critical path memiliki test |
| Public disclosure reduction | Proof membawa ≤ 3 atribut minimum pada demo |
| Recovery clarity | Pengguna memahami alasan proof gagal dalam satu layar |

## 13. Acceptance Criteria

Produk dianggap siap untuk demo ketika:

1. Halaman overview, credentials, proof requests, activity, dan settings dapat dinavigasi.
2. Request pending dapat dibuka dan disetujui dari UI.
3. Setelah approval, status berubah menjadi Approved dan activity bertambah.
4. Credential active dan revoked memiliki tampilan berbeda.
5. UI menampilkan data yang dibagikan dan data yang tetap privat.
6. Layout dapat digunakan pada viewport desktop dan mobile.
7. Tidak ada placeholder lorem ipsum atau button utama yang tidak memiliki feedback.
8. README teknis menjelaskan bahwa connector Midnight pada tahap ini adalah demo adapter jika contract belum terhubung ke network.

## 14. Rollout Wave

| Wave | Fokus | Output |
|---|---|---|
| Wave 1 | Proof of eligibility | Compact contract, satu credential, one-click proof demo, test matrix |
| Wave 2 | Selective disclosure | Template, policy builder, expiry, revocation registry |
| Wave 3 | Adoption proof | Issuer registry, verifier invite, pilot, performance hardening |

## 15. Risiko Produk

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Scope terlalu lebar | MVP tidak selesai | Batasi Wave 1 pada satu credential dan satu policy. |
| Privasi sulit dijelaskan | Juri tidak memahami nilai | Gunakan perbandingan dokumen penuh vs proof minimum. |
| Demo dianggap mockup | Skor engineering turun | Tampilkan compiled contract, test, dan status transition. |
| Koneksi wallet gagal | Demo terhenti | Sediakan demo adapter dengan label yang jujur. |
| Credential issuer tidak dipercaya | Nilai proof dipertanyakan | Tambahkan issuer registry dan trust model pada roadmap. |

## 16. Open Questions

1. API wallet Midnight yang dipakai untuk Wave 1 akan menggunakan adapter resmi yang mana?
2. Apakah revocation state harus public untuk semua verifier atau hanya dapat dibuktikan melalui proof?
3. Apakah demo akan memakai satu testnet instance bersama atau local dev network?
4. Organisasi pilot pertama akan berasal dari komunitas builder, program pelatihan, atau event hackathon?

## 17. Definition of Done

Fitur dianggap selesai apabila desain, implementasi, error state, keyboard navigation, test path, dan dokumentasi sudah tersedia. “Selesai” tidak berarti hanya tampilan happy path berfungsi. Setiap critical flow harus memiliki success, loading, empty, dan failure state.

## Referensi

[1]: /home/ubuntu/midnight_buildathon_ideas.md "ProofPass buildathon concept report"

[2]: /home/ubuntu/upload/pasted_content.txt "Midnight Buildathon brief supplied by the user"

[3]: https://www.w3.org/WAI/standards-guidelines/wcag/ "Web Content Accessibility Guidelines"

Catatan: Jadwal dan ketentuan Buildathon mengikuti brief yang diberikan pengguna. Official Rules tetap menjadi dokumen yang mengikat apabila terjadi perbedaan.


## 18. Incremental Feature Requirements — Wallet and Role Workspaces

### 18.1 Real Midnight wallet connection

The dashboard must detect compatible wallet providers injected through `window.midnight`. It must filter providers by supported DApp Connector API major version, show the wallet name safely, request the intended network explicitly, and display connection errors without exposing sensitive wallet data.

Once connected, the UI may read configuration, addresses, and balances through the Connected API. Transaction actions must be prepared by the application and balanced or submitted through the wallet. Private keys must never be requested, stored, or transmitted by ProofPass.

### 18.2 Issuer workspace

Issuer users require a dedicated workspace for credential registry health, issue and revoke actions, recent registry events, and wallet readiness. The UI must explain that signing remains in the wallet and that holder attributes do not become public registry data.

### 18.3 Verifier workspace

Verifier users require a dedicated workspace for building purpose-bound proof policies. A policy must state its purpose, requested facts, logical conditions, and the fact that the holder controls final disclosure. The first template is bootcamp completion with active and non-expired credential checks.

### 18.4 Dark mode

Dark mode must be switchable from the top navigation, persist through the existing theme provider, and preserve readable contrast across dashboards, dialogs, status pills, tables, and role workspaces.

### 18.5 Consent motion

The consent modal must animate the header, share sections, attributes, note, and actions in a short staggered sequence. Motion must use opacity and transform only, remain below 400 milliseconds for individual elements, and respect `prefers-reduced-motion`.


## 19. Final Increment — Wallet Picker, Persistence, and Compact Runtime

ProofPass shall present a wallet picker whenever the user initiates a connection, rather than silently selecting the first detected provider. Each compatible Midnight DApp Connector is displayed with its provider name, API version, and identifier. The picker must communicate that private keys and seed phrases remain in the wallet. When no compatible provider is detected, the interface shall provide an installation path without pretending that a connection exists.

Authenticated users shall have durable records for wallet provider metadata, issuer identities, credentials, proof requests, and verification outcomes. Private keys, seed phrases, and private credential attributes must never be persisted by ProofPass. Wallet addresses are stored only as public account identifiers, and the UI may shorten them for display while retaining the complete public address for deduplication and registry queries.

The Compact integration shall load the generated contract module and compiled ZK assets through Midnight.js `CompiledContract.make`, `withWitnesses` or `withVacantWitnesses`, and `withCompiledFileAssets`. The adapter must fail explicitly when generated output is missing. The application must never report an on-chain issue or verification transaction as submitted until the generated artifact is loaded, the wallet has approved the action, and the transaction provider has returned a transaction result.
