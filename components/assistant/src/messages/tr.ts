/**
 * The assistant's sentences in Turkish, formal (`siz`; buttons keep the bare
 * verb Turkish interfaces use), key for key with the English catalogue: pass
 * it as `messages` with `lang: 'tr'`, and every key renders Turkish. A noun
 * stays singular after a number (2 model), and a case suffix, which follows
 * vowel harmony, is attached to a fixed word and never to interpolated text,
 * as the suite's own Turkish pack does. The setting examples and product names
 * stay as written; text another package wrote still arrives verbatim inside
 * `error/detail`.
 */
import type { AssistantCatalogue } from '../messages.ts';

const plural = new Intl.PluralRules('tr');
const number = new Intl.NumberFormat('tr-TR');
const num = (value: number) => number.format(value);

export const tr = {
  'launcher/label': ' Asistan',
  'launcher/title': 'Asistanı aç',
  'panel/title': 'Asistan',
  'panel/settings-title': 'Ayarlar',
  'panel/settings-label': 'Asistan ayarları',
  'panel/clear-title': 'Konuşmayı temizle',
  'panel/clear-label': 'Konuşmayı temizle',
  'panel/close-title': 'Kapat',
  'panel/close-label': 'Asistanı kapat',
  'settings/hint': 'Sağlayıcıya giden istekler ayarlarınızı kullanır. Yerel olarak neyin saklanacağına bu uygulama karar verir.',
  'settings/provider': 'Sağlayıcı',
  'settings/api-key': 'API anahtarı',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'Temel URL',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'Model',
  'settings/model-example': 'anthropic/claude-haiku-5.5 · qwen/qwen3.8-27b · …',
  'settings/save': 'Kaydet',
  'settings/test': 'Bağlantıyı test et',
  'settings/testing': 'Test ediliyor…',
  'settings/probe-connected': (p: { count: number }) => `Bağlandı — ${num(p.count)} model kullanılabilir.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'OpenAI uyumlu',
  'intro/text': 'Ne yapmak istediğinizi açıklayın. Asistan, bu uygulamanın sunduğu araçları kullanabilir.',
  'intro/setup': 'Yukarıdan bir sağlayıcı seçin, bir model (OpenRouter için bir anahtar da) ekleyin ve kaydedin — sohbet hemen burada açılır. Seçtiğiniz sağlayıcıya yapılan çağrılar dışında tarayıcınızdan hiçbir şey çıkmaz.',
  'composer/placeholder': 'Asistana sorun…',
  'composer/send': 'Gönder',
  'composer/cancel': 'İptal',
  'activity/running': '{tool} çalıştırılıyor',
  'activity/thinking': 'Düşünüyor…',
  'activity/thinking-count': (p: { count: number }) => `Düşünüyor… (${num(p.count)} karakterlik akıl yürütme)`,
  'goal/placeholder': 'Asistanın oturumlar arasında koruyacağı bir hedef belirleyin…',
  'goal/set': 'Belirle',
  'goal/objective': 'Hedef',
  'goal/clear-title': 'Hedefi temizle',
  'goal/clear-label': 'Hedefi temizle',
  'goal/more': (p: { count: number }) => `…ve önceki ${num(p.count)} kayıt daha`,
  'goal/checkpoint': (p: { count: number }) => `Önceki ${num(p.count)} ilerleme kaydı kanıtlarıyla birlikte saklandı.`,
  'goal/remember': 'Bu oturumu hatırla',
  'goal/remembering': 'Belleğe kaydediliyor…',
  'ledger/memories': (p: { count: number }) => `Hatırlanan ${num(p.count)} bilgi`,
  'ledger/storage-failed': 'Depolama başarısız oldu: {detail}',
  'ledger/single-writer': 'Hatırlanan durumu güncellemek için aynı anda yalnızca bir sekme kullanın.',
  'ledger/evicted': (p: { count: number }) => `Depolama sınırı nedeniyle önceki ${num(p.count)} arşiv adresi kaldırıldı.`,
  'ledger/archived': (p: { count: number }) => plural.select(p.count) === 'one'
    ? `Önceki ${num(p.count)} tur arşivlendi — asistan onu recall ile geri getirebilir.`
    : `Önceki ${num(p.count)} tur arşivlendi — asistan bunların her birini recall ile geri getirebilir.`,
  'note/send-unconfigured': 'Önce ayarlarda bir sağlayıcı, bir model ve (OpenRouter için) bir API anahtarı ekleyin.',
  'note/reasoning-only': '*Model, nihai bir yanıt vermeden tüm turu akıl yürüterek geçirdi — devam etmek için bir mesaj daha gönderin.*',
  'note/empty-reply': '*Model, turunu yanıt vermeden bitirdi — yüklediği her şey ekranda; devam etmek için bir mesaj daha gönderin.*',
  'note/remember-no-run': 'Henüz hatırlanacak bir şey yok — önce bir mesaj gönderin.',
  'note/remember-unconfigured': 'Önce ayarlarda bir sağlayıcı, bir model ve bir anahtar ekleyin.',
  'note/remember-refused': 'Hiçbir şey saklanmadı — {detail}',
  'note/remember-nothing': 'Asistan bu oturumda hatırlamaya değer bir şey bulamadı.',
  'note/remembered': (p: { count: number }) => `Kanıta dayalı ${num(p.count)} öğe belleğe kaydedildi.`,
  'note/settings-not-saved': 'Asistan ayarları kaydedilemedi.',
  'note/transcript-not-saved': 'Asistanla yapılan konuşma kaydedilemedi.',
  'error/detail': 'Hata: {detail}',
  'md/footnotes': 'Dipnotlar',
  'md/page-break': 'Sayfa sonu',
  'md/permalink': '"{text}" bölümüne kalıcı bağlantı',
  'md/permalink-section': 'Bu bölüme kalıcı bağlantı',
  'md/backref': '{number} numaralı atfa geri dön',
  'md/backref-occurrence': '{number} numaralı atfa geri dön, {occurrence}. kullanım',
  'view/status/idle': 'Yeni bir çalıştırmaya hazır.',
  'view/status/starting': 'Çalıştırma başlatılıyor…',
  'view/status/running': 'Çalışıyor…',
  'view/status/cancelling': 'Çalıştırma iptal ediliyor…',
  'view/status/succeeded': 'Asistan bu çalıştırmayı tamamladı.',
  'view/status/failed': 'Asistan bu çalıştırmayı tamamlayamadı.',
  'view/status/cancelled': 'Bu çalıştırma iptal edildi.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `Adım ${num(p.step)} — ${p.stage}` : `Adım ${num(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `Çalıştırma başlatılamadı: ${p.detail}` : 'Çalıştırma başlatılamadı.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `Çalıştırma iptal edilemedi: ${p.detail}` : 'Çalıştırma iptal edilemedi.',
} satisfies Required<AssistantCatalogue>;
