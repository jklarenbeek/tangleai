/**
 * The assistant's sentences in Modern Standard Arabic, formal, key for key
 * with the English catalogue: pass it as `messages` with `dir: 'rtl'` and
 * `lang: 'ar'`, and every key renders Arabic. Arabic has six plural
 * categories, so counted messages phrase around a fixed "عدد" (count of)
 * noun instead of agreeing a noun with the number, and numbers keep Latin
 * digits, as the suite's own Arabic pack does. The setting examples and
 * product names stay as written; text another package wrote still arrives
 * verbatim inside `error/detail`.
 */
import type { AssistantCatalogue } from '../messages.ts';

const number = new Intl.NumberFormat('ar', { numberingSystem: 'latn' });
const num = (value: number) => number.format(value);

export const ar = {
  'launcher/label': ' المساعد',
  'launcher/title': 'فتح المساعد',
  'panel/title': 'المساعد',
  'panel/settings-title': 'الإعدادات',
  'panel/settings-label': 'إعدادات المساعد',
  'panel/clear-title': 'مسح المحادثة',
  'panel/clear-label': 'مسح المحادثة',
  'panel/close-title': 'إغلاق',
  'panel/close-label': 'إغلاق المساعد',
  'settings/hint': 'تستخدم الطلبات المرسلة إلى المزوّد إعداداتك، ويحدّد هذا المضيف ما يُحفظ محليًا.',
  'settings/provider': 'المزوّد',
  'settings/api-key': 'مفتاح API',
  'settings/api-key-example': 'sk-…',
  'settings/base-url': 'عنوان URL الأساسي',
  'settings/base-url-example': 'http://localhost:11434 · https://…/v1',
  'settings/model': 'النموذج',
  'settings/model-example': 'qwen/qwen3-4b · llama3.2 · …',
  'settings/save': 'حفظ',
  'settings/test': 'اختبار الاتصال',
  'settings/testing': 'جارٍ الاختبار…',
  'settings/probe-connected': (p: { count: number }) => `تم الاتصال — عدد النماذج المتاحة: ${num(p.count)}.`,
  'provider/openrouter': 'OpenRouter',
  'provider/ollama': 'Ollama',
  'provider/lmstudio': 'LM Studio',
  'provider/custom': 'متوافق مع OpenAI',
  'intro/text': 'صِف ما تودّ إنجازه. يمكن للمساعد استخدام الأدوات التي يوفّرها هذا المضيف.',
  'intro/setup': 'اختر مزوّدًا أعلاه، وأضف نموذجًا (ومفتاحًا لـ OpenRouter)، ثم احفظ — ستُفتح المحادثة هنا مباشرةً. لا يغادر متصفحك شيء سوى الطلبات المرسلة إلى المزوّد الذي تختاره.',
  'composer/placeholder': 'اسأل المساعد…',
  'composer/send': 'إرسال',
  'composer/cancel': 'إلغاء',
  'activity/running': 'جارٍ تشغيل {tool}',
  'activity/thinking': 'جارٍ التفكير…',
  'activity/thinking-count': (p: { count: number }) => `جارٍ التفكير… (عدد أحرف الاستدلال: ${num(p.count)})`,
  'goal/placeholder': 'حدّد هدفًا يحتفظ به المساعد عبر الجلسات…',
  'goal/set': 'تعيين',
  'goal/objective': 'الهدف',
  'goal/clear-title': 'مسح الهدف',
  'goal/clear-label': 'مسح الهدف',
  'goal/more': (p: { count: number }) => `…وعدد الإدخالات السابقة الأخرى: ${num(p.count)}`,
  'goal/checkpoint': (p: { count: number }) => `عدد إدخالات التقدّم السابقة المحفوظة مع أدلّتها: ${num(p.count)}.`,
  'goal/remember': 'تذكّر هذه الجلسة',
  'goal/remembering': 'جارٍ التذكّر…',
  'ledger/memories': (p: { count: number }) => `عدد الحقائق المحفوظة: ${num(p.count)}`,
  'ledger/storage-failed': 'تعذّر التخزين: {detail}',
  'ledger/single-writer': 'استخدم علامة تبويب واحدة في كل مرة لتحديث البيانات المحفوظة.',
  'ledger/evicted': (p: { count: number }) => `عدد عناوين الأرشيف السابقة التي أُزيلت بسبب حدّ التخزين: ${num(p.count)}.`,
  'ledger/archived': (p: { count: number }) => `عدد الجولات السابقة المؤرشفة: ${num(p.count)} — يمكن للمساعد استرجاعها باستخدام recall.`,
  'note/send-unconfigured': 'أضف أولًا مزوّدًا ونموذجًا و(لـ OpenRouter) مفتاح API في الإعدادات.',
  'note/reasoning-only': '*أمضى النموذج الدور كله في الاستدلال دون ردّ نهائي — أرسل رسالة أخرى للمتابعة.*',
  'note/empty-reply': '*أنهى النموذج دوره دون ردّ — ما حمّله معروض على الشاشة؛ أرسل رسالة أخرى للمتابعة.*',
  'note/remember-no-run': 'لا يوجد ما يُحفظ بعد — أرسل رسالة أولًا.',
  'note/remember-unconfigured': 'أضف أولًا مزوّدًا ونموذجًا ومفتاحًا في الإعدادات.',
  'note/remember-refused': 'لم يُحفظ أي شيء — {detail}',
  'note/remember-nothing': 'لم يجد المساعد في هذه الجلسة ما يستحق الحفظ.',
  'note/remembered': (p: { count: number }) => `عدد العناصر الموثّقة التي حُفظت: ${num(p.count)}.`,
  'note/settings-not-saved': 'تعذّر حفظ إعدادات المساعد.',
  'note/transcript-not-saved': 'تعذّر حفظ سجلّ محادثة المساعد.',
  'error/detail': 'خطأ: {detail}',
  'md/footnotes': 'الحواشي',
  'view/status/idle': 'جاهز لمهمة جديدة.',
  'view/status/starting': 'جارٍ بدء المهمة…',
  'view/status/running': 'جارٍ العمل…',
  'view/status/cancelling': 'جارٍ إلغاء المهمة…',
  'view/status/succeeded': 'أنهى المساعد هذه المهمة.',
  'view/status/failed': 'تعذّر على المساعد إنهاء هذه المهمة.',
  'view/status/cancelled': 'أُلغيت هذه المهمة.',
  'view/progress': (p: { step?: number, stage?: string }) => p.step === undefined ? p.stage ?? ''
    : p.stage ? `الخطوة ${num(p.step)} — ${p.stage}` : `الخطوة ${num(p.step)}`,
  'view/start-failed': (p: { detail?: string }) => p.detail ? `تعذّر بدء المهمة: ${p.detail}` : 'تعذّر بدء المهمة.',
  'view/cancel-failed': (p: { detail?: string }) => p.detail ? `تعذّر إلغاء المهمة: ${p.detail}` : 'تعذّر إلغاء المهمة.',
} satisfies Required<AssistantCatalogue>;
