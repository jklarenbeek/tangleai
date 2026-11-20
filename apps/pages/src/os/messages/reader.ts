/**
 * The sentences of the Docs and Benchmarks applications, in English and in every
 * pack, kept beside those applications so the catalogue grows in one place.
 * `../messages.ts` spreads the English into the catalogue and `../packs.ts`
 * spreads each language into its pack; the language spec holds every key to
 * the same rules as the rest of the catalogue. `{k}` is a number already
 * written in the reader's digits; `{files}` names results files as written.
 */
export const readerEn = {
  'reader/rail-docs': 'Documents', // Docs: accessible name of the list of documents beside the reading pane
  'reader/rail-reports': 'Reports', // Benchmarks: accessible name of the list of reports beside the reading pane
  'reader/group-overview': 'Overview', // Docs rail: the README, architecture, roadmap and papers
  'reader/group-workflow': 'Workflow', // Docs rail: how the repository is worked on (docs/workflow)
  'reader/group-packages': 'Packages', // Docs rail: every package's and component's README and its own documents
  'reader/group-reports': 'Reports', // Benchmarks rail: the generated and measured benchmark reports
  'reader/loading': 'Loading the document…', // Reading pane: while a document is fetched
  'reader/index-failed': 'The list of documents could not be loaded. Check the connection and try again.', // Reading pane: the index could not be fetched
  'reader/doc-failed': 'This document could not be loaded. Check the connection and try again.', // Reading pane: one document could not be fetched
  'reader/retry': 'Try again', // Reading pane: button that fetches what failed again
  'reader/on-github': 'View on GitHub', // Reading pane: link to the open document in the repository
  'reader/chart-from': 'Drawn from the measured results in {files}.', // Benchmarks: caption under a headline chart; {files} are results file names
  'reader/chart-failed': 'The measured results for this chart could not be loaded.', // Benchmarks: the results file of a headline chart could not be fetched
  'reader/chart-recall-title': 'Evidence recall per row, by the number of retrieved items', // Benchmarks: headline chart of the LoCoMo recall report
  'reader/chart-recall-series': 'Recall at {k}', // Benchmarks: one series of the recall chart; {k} is how many items were retrieved
  'reader/chart-jaren-title': 'History reads, 95th percentile in milliseconds', // Benchmarks: headline chart of the Jaren strategies report
  'reader/chart-jaren-previous': 'Whole history', // Benchmarks: the strategy that reads every row of the history
  'reader/chart-jaren-bounded': 'Bounded read', // Benchmarks: the strategy that reads only the rows asked for
  'reader/chart-strict-title': 'Live structured output, per schema form', // Benchmarks: headline chart of the strict profile report
  'reader/chart-strict-as-is': 'Schema as written', // Benchmarks: requests that sent each schema unchanged
  'reader/chart-strict-profile': 'Strict profile', // Benchmarks: requests that sent each schema's strict profile
  'reader/chart-outcome-refused': 'Refused', // Benchmarks: the provider refused the request
  'reader/chart-outcome-valid': 'Valid', // Benchmarks: the answer matched its schema
  'reader/chart-outcome-invalid': 'Invalid', // Benchmarks: the answer did not match its schema
  'reader/chart-outcome-error': 'Error', // Benchmarks: the request failed for another reason
  'reader/chart-authoring-title': 'Plain requests that ended in a working application', // Benchmarks: headline chart of the authoring report
  'reader/chart-authoring-en': 'Conversation, English', // Benchmarks: the run of English conversations with the assistant
  'reader/chart-authoring-nl': 'Conversation, Dutch', // Benchmarks: the run of Dutch conversations with the assistant
  'reader/chart-authoring-alone': 'Author alone', // Benchmarks: the run of the application author without a conversation
  'reader/chart-runs': 'Requests', // Benchmarks: how many requests a run made
  'reader/chart-works': 'Working applications', // Benchmarks: how many of them ended in an application that works
} as const;

/** The same keys, per language (formal register), each a string or a closure over the entry's parameters. */
export const readerPacks: Record<'ar' | 'de' | 'es' | 'fr' | 'ja' | 'ko' | 'nl' | 'pt' | 'ru' | 'tr' | 'zh-TW', Partial<Record<keyof typeof readerEn, string | ((params: any) => string)>>> = {
  nl: {
    'reader/rail-docs': 'Documenten', 'reader/rail-reports': 'Rapporten',
    'reader/group-overview': 'Overzicht', 'reader/group-workflow': 'Werkwijze', 'reader/group-packages': 'Pakketten', 'reader/group-reports': 'Rapporten',
    'reader/loading': 'Het document wordt geladen…',
    'reader/index-failed': 'De lijst met documenten kon niet worden geladen. Controleer de verbinding en probeer het opnieuw.',
    'reader/doc-failed': 'Dit document kon niet worden geladen. Controleer de verbinding en probeer het opnieuw.',
    'reader/retry': 'Opnieuw proberen', 'reader/on-github': 'Bekijken op GitHub',
    'reader/chart-from': 'Getekend uit de gemeten resultaten in {files}.',
    'reader/chart-failed': 'De gemeten resultaten voor deze grafiek konden niet worden geladen.',
    'reader/chart-recall-title': 'Bewijsrecall per rij, naar het aantal opgehaalde items', 'reader/chart-recall-series': 'Recall bij {k}',
    'reader/chart-jaren-title': 'Geschiedenis lezen, 95e percentiel in milliseconden', 'reader/chart-jaren-previous': 'Hele geschiedenis', 'reader/chart-jaren-bounded': 'Begrensd lezen',
    'reader/chart-strict-title': 'Live gestructureerde uitvoer, per schemavorm', 'reader/chart-strict-as-is': 'Schema zoals geschreven', 'reader/chart-strict-profile': 'Strikt profiel',
    'reader/chart-outcome-refused': 'Geweigerd', 'reader/chart-outcome-valid': 'Geldig', 'reader/chart-outcome-invalid': 'Ongeldig', 'reader/chart-outcome-error': 'Fout',
    'reader/chart-authoring-title': 'Gewone verzoeken die eindigden in een werkende applicatie', 'reader/chart-authoring-en': 'Gesprek, Engels', 'reader/chart-authoring-nl': 'Gesprek, Nederlands', 'reader/chart-authoring-alone': 'Alleen de auteur',
    'reader/chart-runs': 'Verzoeken', 'reader/chart-works': 'Werkende applicaties',
  },
  de: {
    'reader/rail-docs': 'Dokumente', 'reader/rail-reports': 'Berichte',
    'reader/group-overview': 'Überblick', 'reader/group-workflow': 'Arbeitsweise', 'reader/group-packages': 'Pakete', 'reader/group-reports': 'Berichte',
    'reader/loading': 'Das Dokument wird geladen…',
    'reader/index-failed': 'Die Liste der Dokumente konnte nicht geladen werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.',
    'reader/doc-failed': 'Dieses Dokument konnte nicht geladen werden. Prüfen Sie die Verbindung und versuchen Sie es erneut.',
    'reader/retry': 'Erneut versuchen', 'reader/on-github': 'Auf GitHub ansehen',
    'reader/chart-from': 'Gezeichnet aus den gemessenen Ergebnissen in {files}.',
    'reader/chart-failed': 'Die gemessenen Ergebnisse für dieses Diagramm konnten nicht geladen werden.',
    'reader/chart-recall-title': 'Beleg-Recall je Zeile, nach Zahl der abgerufenen Einträge', 'reader/chart-recall-series': 'Recall bei {k}',
    'reader/chart-jaren-title': 'Verlauf lesen, 95. Perzentil in Millisekunden', 'reader/chart-jaren-previous': 'Ganzer Verlauf', 'reader/chart-jaren-bounded': 'Begrenztes Lesen',
    'reader/chart-strict-title': 'Strukturierte Live-Ausgabe, je Schemaform', 'reader/chart-strict-as-is': 'Schema wie geschrieben', 'reader/chart-strict-profile': 'Striktes Profil',
    'reader/chart-outcome-refused': 'Abgelehnt', 'reader/chart-outcome-valid': 'Gültig', 'reader/chart-outcome-invalid': 'Ungültig', 'reader/chart-outcome-error': 'Fehler',
    'reader/chart-authoring-title': 'Einfache Anfragen, die in einer funktionierenden Anwendung endeten', 'reader/chart-authoring-en': 'Gespräch, Englisch', 'reader/chart-authoring-nl': 'Gespräch, Niederländisch', 'reader/chart-authoring-alone': 'Nur der Autor',
    'reader/chart-runs': 'Anfragen', 'reader/chart-works': 'Funktionierende Anwendungen',
  },
  fr: {
    'reader/rail-docs': 'Documents', 'reader/rail-reports': 'Rapports',
    'reader/group-overview': 'Vue d\'ensemble', 'reader/group-workflow': 'Méthode de travail', 'reader/group-packages': 'Paquets', 'reader/group-reports': 'Rapports',
    'reader/loading': 'Chargement du document…',
    'reader/index-failed': 'La liste des documents n\'a pas pu être chargée. Vérifiez la connexion et réessayez.',
    'reader/doc-failed': 'Ce document n\'a pas pu être chargé. Vérifiez la connexion et réessayez.',
    'reader/retry': 'Réessayer', 'reader/on-github': 'Voir sur GitHub',
    'reader/chart-from': 'Tracé à partir des résultats mesurés dans {files}.',
    'reader/chart-failed': 'Les résultats mesurés de ce graphique n\'ont pas pu être chargés.',
    'reader/chart-recall-title': 'Rappel des preuves par ligne, selon le nombre d\'éléments récupérés', 'reader/chart-recall-series': 'Rappel à {k}',
    'reader/chart-jaren-title': 'Lectures d\'historique, 95e centile en millisecondes', 'reader/chart-jaren-previous': 'Historique complet', 'reader/chart-jaren-bounded': 'Lecture bornée',
    'reader/chart-strict-title': 'Sortie structurée en direct, par forme de schéma', 'reader/chart-strict-as-is': 'Schéma tel qu\'écrit', 'reader/chart-strict-profile': 'Profil strict',
    'reader/chart-outcome-refused': 'Refusé', 'reader/chart-outcome-valid': 'Valide', 'reader/chart-outcome-invalid': 'Non valide', 'reader/chart-outcome-error': 'Erreur',
    'reader/chart-authoring-title': 'Demandes simples ayant abouti à une application qui fonctionne', 'reader/chart-authoring-en': 'Conversation, anglais', 'reader/chart-authoring-nl': 'Conversation, néerlandais', 'reader/chart-authoring-alone': 'Auteur seul',
    'reader/chart-runs': 'Demandes', 'reader/chart-works': 'Applications qui fonctionnent',
  },
  es: {
    'reader/rail-docs': 'Documentos', 'reader/rail-reports': 'Informes',
    'reader/group-overview': 'Visión general', 'reader/group-workflow': 'Forma de trabajo', 'reader/group-packages': 'Paquetes', 'reader/group-reports': 'Informes',
    'reader/loading': 'Cargando el documento…',
    'reader/index-failed': 'No se pudo cargar la lista de documentos. Compruebe la conexión e inténtelo de nuevo.',
    'reader/doc-failed': 'No se pudo cargar este documento. Compruebe la conexión e inténtelo de nuevo.',
    'reader/retry': 'Intentar de nuevo', 'reader/on-github': 'Ver en GitHub',
    'reader/chart-from': 'Dibujado a partir de los resultados medidos en {files}.',
    'reader/chart-failed': 'No se pudieron cargar los resultados medidos de este gráfico.',
    'reader/chart-recall-title': 'Exhaustividad de las pruebas por fila, según el número de elementos recuperados', 'reader/chart-recall-series': 'Exhaustividad con {k}',
    'reader/chart-jaren-title': 'Lecturas del historial, percentil 95 en milisegundos', 'reader/chart-jaren-previous': 'Historial completo', 'reader/chart-jaren-bounded': 'Lectura acotada',
    'reader/chart-strict-title': 'Salida estructurada en vivo, por forma de esquema', 'reader/chart-strict-as-is': 'Esquema tal como está escrito', 'reader/chart-strict-profile': 'Perfil estricto',
    'reader/chart-outcome-refused': 'Rechazado', 'reader/chart-outcome-valid': 'Válido', 'reader/chart-outcome-invalid': 'No válido', 'reader/chart-outcome-error': 'Error',
    'reader/chart-authoring-title': 'Solicitudes sencillas que terminaron en una aplicación que funciona', 'reader/chart-authoring-en': 'Conversación, inglés', 'reader/chart-authoring-nl': 'Conversación, neerlandés', 'reader/chart-authoring-alone': 'Solo el autor',
    'reader/chart-runs': 'Solicitudes', 'reader/chart-works': 'Aplicaciones que funcionan',
  },
  pt: {
    'reader/rail-docs': 'Documentos', 'reader/rail-reports': 'Relatórios',
    'reader/group-overview': 'Visão geral', 'reader/group-workflow': 'Forma de trabalho', 'reader/group-packages': 'Pacotes', 'reader/group-reports': 'Relatórios',
    'reader/loading': 'Carregando o documento…',
    'reader/index-failed': 'Não foi possível carregar a lista de documentos. Verifique a conexão e tente novamente.',
    'reader/doc-failed': 'Não foi possível carregar este documento. Verifique a conexão e tente novamente.',
    'reader/retry': 'Tentar novamente', 'reader/on-github': 'Ver no GitHub',
    'reader/chart-from': 'Desenhado a partir dos resultados medidos em {files}.',
    'reader/chart-failed': 'Não foi possível carregar os resultados medidos deste gráfico.',
    'reader/chart-recall-title': 'Revocação das evidências por linha, pelo número de itens recuperados', 'reader/chart-recall-series': 'Revocação em {k}',
    'reader/chart-jaren-title': 'Leituras do histórico, percentil 95 em milissegundos', 'reader/chart-jaren-previous': 'Histórico completo', 'reader/chart-jaren-bounded': 'Leitura limitada',
    'reader/chart-strict-title': 'Saída estruturada ao vivo, por forma de esquema', 'reader/chart-strict-as-is': 'Esquema como escrito', 'reader/chart-strict-profile': 'Perfil estrito',
    'reader/chart-outcome-refused': 'Recusado', 'reader/chart-outcome-valid': 'Válido', 'reader/chart-outcome-invalid': 'Inválido', 'reader/chart-outcome-error': 'Erro',
    'reader/chart-authoring-title': 'Pedidos simples que terminaram em um aplicativo que funciona', 'reader/chart-authoring-en': 'Conversa, inglês', 'reader/chart-authoring-nl': 'Conversa, neerlandês', 'reader/chart-authoring-alone': 'Somente o autor',
    'reader/chart-runs': 'Pedidos', 'reader/chart-works': 'Aplicativos que funcionam',
  },
  ar: {
    'reader/rail-docs': 'المستندات', 'reader/rail-reports': 'التقارير',
    'reader/group-overview': 'نظرة عامة', 'reader/group-workflow': 'طريقة العمل', 'reader/group-packages': 'الحزم', 'reader/group-reports': 'التقارير',
    'reader/loading': 'جارٍ تحميل المستند…',
    'reader/index-failed': 'تعذّر تحميل قائمة المستندات. يُرجى التحقق من الاتصال والمحاولة مرة أخرى.',
    'reader/doc-failed': 'تعذّر تحميل هذا المستند. يُرجى التحقق من الاتصال والمحاولة مرة أخرى.',
    'reader/retry': 'المحاولة مرة أخرى', 'reader/on-github': 'العرض على GitHub',
    'reader/chart-from': 'مرسوم من النتائج المقيسة في {files}.',
    'reader/chart-failed': 'تعذّر تحميل النتائج المقيسة لهذا المخطط.',
    'reader/chart-recall-title': 'استرجاع الأدلة لكل صف، بحسب عدد العناصر المسترجعة', 'reader/chart-recall-series': 'الاسترجاع عند {k}',
    'reader/chart-jaren-title': 'قراءات السجل، المئين 95 بالمللي ثانية', 'reader/chart-jaren-previous': 'السجل كاملًا', 'reader/chart-jaren-bounded': 'قراءة محدودة',
    'reader/chart-strict-title': 'المخرجات المهيكلة المباشرة، لكل شكل من أشكال المخطط', 'reader/chart-strict-as-is': 'المخطط كما كُتب', 'reader/chart-strict-profile': 'الملف الصارم',
    'reader/chart-outcome-refused': 'مرفوض', 'reader/chart-outcome-valid': 'صالح', 'reader/chart-outcome-invalid': 'غير صالح', 'reader/chart-outcome-error': 'خطأ',
    'reader/chart-authoring-title': 'طلبات بسيطة انتهت بتطبيق يعمل', 'reader/chart-authoring-en': 'محادثة، بالإنجليزية', 'reader/chart-authoring-nl': 'محادثة، بالهولندية', 'reader/chart-authoring-alone': 'المؤلف وحده',
    'reader/chart-runs': 'الطلبات', 'reader/chart-works': 'تطبيقات تعمل',
  },
  ja: {
    'reader/rail-docs': 'ドキュメント', 'reader/rail-reports': 'レポート',
    'reader/group-overview': '概要', 'reader/group-workflow': '作業の進め方', 'reader/group-packages': 'パッケージ', 'reader/group-reports': 'レポート',
    'reader/loading': 'ドキュメントを読み込んでいます…',
    'reader/index-failed': 'ドキュメントの一覧を読み込めませんでした。接続を確認して、もう一度お試しください。',
    'reader/doc-failed': 'このドキュメントを読み込めませんでした。接続を確認して、もう一度お試しください。',
    'reader/retry': 'もう一度試す', 'reader/on-github': 'GitHub で表示',
    'reader/chart-from': '{files} の計測結果から描画しています。',
    'reader/chart-failed': 'このチャートの計測結果を読み込めませんでした。',
    'reader/chart-recall-title': '行ごとの根拠の再現率（取得件数別）', 'reader/chart-recall-series': '{k} 件での再現率',
    'reader/chart-jaren-title': '履歴の読み取り、95 パーセンタイル（ミリ秒）', 'reader/chart-jaren-previous': '履歴全体', 'reader/chart-jaren-bounded': '範囲を限った読み取り',
    'reader/chart-strict-title': 'ライブの構造化出力（スキーマの形式別）', 'reader/chart-strict-as-is': '記述どおりのスキーマ', 'reader/chart-strict-profile': '厳格プロファイル',
    'reader/chart-outcome-refused': '拒否', 'reader/chart-outcome-valid': '有効', 'reader/chart-outcome-invalid': '無効', 'reader/chart-outcome-error': 'エラー',
    'reader/chart-authoring-title': '動作するアプリケーションにたどり着いた平易な依頼', 'reader/chart-authoring-en': '会話（英語）', 'reader/chart-authoring-nl': '会話（オランダ語）', 'reader/chart-authoring-alone': '作成者のみ',
    'reader/chart-runs': '依頼', 'reader/chart-works': '動作するアプリケーション',
  },
  ko: {
    'reader/rail-docs': '문서', 'reader/rail-reports': '보고서',
    'reader/group-overview': '개요', 'reader/group-workflow': '작업 방식', 'reader/group-packages': '패키지', 'reader/group-reports': '보고서',
    'reader/loading': '문서를 불러오는 중입니다…',
    'reader/index-failed': '문서 목록을 불러올 수 없습니다. 연결을 확인한 후 다시 시도해 주십시오.',
    'reader/doc-failed': '이 문서를 불러올 수 없습니다. 연결을 확인한 후 다시 시도해 주십시오.',
    'reader/retry': '다시 시도', 'reader/on-github': 'GitHub에서 보기',
    'reader/chart-from': '{files}의 측정 결과로 그렸습니다.',
    'reader/chart-failed': '이 차트의 측정 결과를 불러올 수 없습니다.',
    'reader/chart-recall-title': '행별 근거 재현율(가져온 항목 수별)', 'reader/chart-recall-series': '{k}개에서의 재현율',
    'reader/chart-jaren-title': '기록 읽기, 95번째 백분위수(밀리초)', 'reader/chart-jaren-previous': '전체 기록', 'reader/chart-jaren-bounded': '범위를 제한한 읽기',
    'reader/chart-strict-title': '실시간 구조화 출력(스키마 형식별)', 'reader/chart-strict-as-is': '작성된 그대로의 스키마', 'reader/chart-strict-profile': '엄격 프로필',
    'reader/chart-outcome-refused': '거부됨', 'reader/chart-outcome-valid': '유효', 'reader/chart-outcome-invalid': '유효하지 않음', 'reader/chart-outcome-error': '오류',
    'reader/chart-authoring-title': '작동하는 애플리케이션으로 끝난 일반 요청', 'reader/chart-authoring-en': '대화, 영어', 'reader/chart-authoring-nl': '대화, 네덜란드어', 'reader/chart-authoring-alone': '작성자 단독',
    'reader/chart-runs': '요청', 'reader/chart-works': '작동하는 애플리케이션',
  },
  ru: {
    'reader/rail-docs': 'Документы', 'reader/rail-reports': 'Отчёты',
    'reader/group-overview': 'Обзор', 'reader/group-workflow': 'Порядок работы', 'reader/group-packages': 'Пакеты', 'reader/group-reports': 'Отчёты',
    'reader/loading': 'Документ загружается…',
    'reader/index-failed': 'Не удалось загрузить список документов. Проверьте подключение и повторите попытку.',
    'reader/doc-failed': 'Не удалось загрузить этот документ. Проверьте подключение и повторите попытку.',
    'reader/retry': 'Повторить попытку', 'reader/on-github': 'Открыть на GitHub',
    'reader/chart-from': 'Построено по измеренным результатам из {files}.',
    'reader/chart-failed': 'Не удалось загрузить измеренные результаты для этой диаграммы.',
    'reader/chart-recall-title': 'Полнота свидетельств по строкам в зависимости от числа извлечённых элементов', 'reader/chart-recall-series': 'Полнота при {k}',
    'reader/chart-jaren-title': 'Чтение истории, 95-й процентиль в миллисекундах', 'reader/chart-jaren-previous': 'Вся история', 'reader/chart-jaren-bounded': 'Ограниченное чтение',
    'reader/chart-strict-title': 'Структурированный вывод в реальном времени по форме схемы', 'reader/chart-strict-as-is': 'Схема как написана', 'reader/chart-strict-profile': 'Строгий профиль',
    'reader/chart-outcome-refused': 'Отклонено', 'reader/chart-outcome-valid': 'Корректно', 'reader/chart-outcome-invalid': 'Некорректно', 'reader/chart-outcome-error': 'Ошибка',
    'reader/chart-authoring-title': 'Простые запросы, завершившиеся работающим приложением', 'reader/chart-authoring-en': 'Диалог, английский', 'reader/chart-authoring-nl': 'Диалог, нидерландский', 'reader/chart-authoring-alone': 'Только автор',
    'reader/chart-runs': 'Запросы', 'reader/chart-works': 'Работающие приложения',
  },
  tr: {
    'reader/rail-docs': 'Belgeler', 'reader/rail-reports': 'Raporlar',
    'reader/group-overview': 'Genel bakış', 'reader/group-workflow': 'Çalışma biçimi', 'reader/group-packages': 'Paketler', 'reader/group-reports': 'Raporlar',
    'reader/loading': 'Belge yükleniyor…',
    'reader/index-failed': 'Belge listesi yüklenemedi. Lütfen bağlantıyı denetleyip yeniden deneyin.',
    'reader/doc-failed': 'Bu belge yüklenemedi. Lütfen bağlantıyı denetleyip yeniden deneyin.',
    'reader/retry': 'Yeniden dene', 'reader/on-github': 'GitHub\'da görüntüle',
    'reader/chart-from': '{files} içindeki ölçülmüş sonuçlardan çizilmiştir.',
    'reader/chart-failed': 'Bu grafiğin ölçülmüş sonuçları yüklenemedi.',
    'reader/chart-recall-title': 'Satır başına kanıt geri çağırma oranı, getirilen öğe sayısına göre', 'reader/chart-recall-series': '{k} öğede geri çağırma',
    'reader/chart-jaren-title': 'Geçmiş okumaları, milisaniye cinsinden 95. yüzdelik', 'reader/chart-jaren-previous': 'Tüm geçmiş', 'reader/chart-jaren-bounded': 'Sınırlı okuma',
    'reader/chart-strict-title': 'Canlı yapılandırılmış çıktı, şema biçimine göre', 'reader/chart-strict-as-is': 'Yazıldığı gibi şema', 'reader/chart-strict-profile': 'Katı profil',
    'reader/chart-outcome-refused': 'Reddedildi', 'reader/chart-outcome-valid': 'Geçerli', 'reader/chart-outcome-invalid': 'Geçersiz', 'reader/chart-outcome-error': 'Hata',
    'reader/chart-authoring-title': 'Çalışan bir uygulamayla sonuçlanan sade istekler', 'reader/chart-authoring-en': 'Konuşma, İngilizce', 'reader/chart-authoring-nl': 'Konuşma, Felemenkçe', 'reader/chart-authoring-alone': 'Yalnızca yazar',
    'reader/chart-runs': 'İstekler', 'reader/chart-works': 'Çalışan uygulamalar',
  },
  'zh-TW': {
    'reader/rail-docs': '文件', 'reader/rail-reports': '報告',
    'reader/group-overview': '概覽', 'reader/group-workflow': '工作方式', 'reader/group-packages': '套件', 'reader/group-reports': '報告',
    'reader/loading': '正在載入文件…',
    'reader/index-failed': '無法載入文件清單。請檢查連線後再試一次。',
    'reader/doc-failed': '無法載入此文件。請檢查連線後再試一次。',
    'reader/retry': '再試一次', 'reader/on-github': '在 GitHub 上檢視',
    'reader/chart-from': '依據 {files} 中的量測結果繪製。',
    'reader/chart-failed': '無法載入此圖表的量測結果。',
    'reader/chart-recall-title': '各列的證據召回率（依擷取項目數）', 'reader/chart-recall-series': '{k} 項時的召回率',
    'reader/chart-jaren-title': '歷程讀取，第 95 百分位數（毫秒）', 'reader/chart-jaren-previous': '完整歷程', 'reader/chart-jaren-bounded': '限定範圍讀取',
    'reader/chart-strict-title': '即時結構化輸出（依結構描述形式）', 'reader/chart-strict-as-is': '原樣的結構描述', 'reader/chart-strict-profile': '嚴格設定檔',
    'reader/chart-outcome-refused': '遭拒', 'reader/chart-outcome-valid': '有效', 'reader/chart-outcome-invalid': '無效', 'reader/chart-outcome-error': '錯誤',
    'reader/chart-authoring-title': '最終成為可運作應用程式的一般請求', 'reader/chart-authoring-en': '對話，英文', 'reader/chart-authoring-nl': '對話，荷蘭文', 'reader/chart-authoring-alone': '僅由作者',
    'reader/chart-runs': '請求', 'reader/chart-works': '可運作的應用程式',
  },
};
