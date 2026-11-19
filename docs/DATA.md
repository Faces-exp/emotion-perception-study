# Данные процедуры 0.3 · CSV

Один participant_id задаётся в начале, condition назначается один раз. session_id — UUID сессии. Новые завершённые прохождения создают два CSV UTF-8 с BOM; UUID входит в имена, чтобы одинаковые participant_id не перезаписывали файлы.

## trials_<participant_id>_<session_id>.csv

Ровно 48 строк, отсортированных по порядку предъявления. Поля genuine/posed — стабильные коды, подписи на русском находятся в дополнительных столбцах.

| Столбец | Смысл |
|---|---|
| participant_id, session_id, condition | Код, UUID, high_power / no_power |
| trial_number | Порядковый номер основной пробы 1–48 |
| video_filename | Оригинальное имя AVI |
| emotion | Эмоциональная категория PEDFE |
| authenticity | genuine / posed из T5 |
| response | genuine / posed, ответ участника |
| correct | 0 или 1, совпадение response и authenticity |
| video_duration_ms | Продолжительность видео по браузеру |
| reaction_time_ms | От первого фактического кадра до первого принятого ответа |
| response_during_video | true до ended, false после |
| response_after_end_ms | 0 при раннем ответе; задержка после ended при позднем |
| trial_completed_correctly | Досмотр подтверждён и технический quality_flag не установлен |
| watched_to_end, quality_flag | Досмотр и отдельная отметка необходимости технической проверки |
| onset_source | video_frame_callback, запасной playing_event |
| onset_perf_ms, response_perf_ms, ended_perf_ms | Временная шкала браузера; RT = response_perf_ms − onset_perf_ms |
| video_started_at, answered_at, video_ended_at, trial_ended_at | UTC по часам устройства |
| fixation_duration_ms, configured_fixation_ms | Фактическая фиксация и настройка 600 мс |
| next_clicked_at, next_elapsed_ms | Нажатие «Далее», отдельно от RT; присоединено из журнала |
| playback_events | Массив технических событий в текстовой ячейке CSV |
| hidden_ms, media_error_count, dropped_video_frames, attempt | Скрытие, ошибки, кадры, номер попытки |
| screen_width, screen_height, browser_family, fullscreen, autoplay_blocked | Условия предъявления |
| study_version, manifest_version, is_test, media_mode | Версии, TEST и тип материалов |
| participant_filename | Имя второго файла пары |

Оригинальные технические поля 0.2, в том числе rt_ms, stimulus_filename, stimulus_type и response_before_end, также сохранены. Новые обязательные имена являются точными алиасами этих значений; расчёт RT и предъявление не менялись. Никакие флаги качества автоматически не удаляют строки.

## participant_<participant_id>_<session_id>.csv

Одна строка:

- participant_id, session_id, condition, study_version, procedure_version;
- allocation: anna_A / anna_B; allocation_action: binding_decision / acknowledgement;
- anna_set, anna_video_count, mikhail_set, mikhail_video_count, allocation_rt_ms;
- perceived_social_power, emotion_recognition_ease, role_consideration — **три отдельные целые оценки 1–7**;
- status=complete, is_test, consent, adult, allow_use_after_debrief, started_at, completed_at;
- n_main=48, n_correct, accuracy_percent=n_correct/48*100;
- trials_filename, participant_filename — два файла одной сессии;
- practice_count=4, practice_trials — отдельный массив четырёх тренировок в текстовой ячейке;
- technical_journal — первый ответ и нажатие «Далее» каждой пробы, включая тренировку;
- main_order, practice_order, instruction_log — порядки и подтверждения отображённых инструкций;
- streaming_enabled — удалось ли включить промежуточную запись DataPipe.

Структурированные ячейки корректно экранируются по правилам CSV и при необходимости разбираются как JSON-значения внутри ячейки. Сам файл является CSV и открывается в Excel/R/Python/Jamovi. Все исследовательские показатели — отдельные простые столбцы. Среднего power_mean нет: вопросы измеряют разные аспекты. Основная зависимая переменная не включает ответы опроса.

## Надёжность и анализ

Первая отправка — trials; вторая — participant, после подтверждения первой. Для итогового анализа проверяйте наличие пары, совпадение session_id и наличие всех 48 проб. Подтверждения хранятся отдельно по каждому имени. При сетевой ошибке повторяется только неподтверждённый CSV с неизменным содержимым. 201 — сохранён сервисом, 202 — принят в очередь. Время фактического появления видно по времени создания в Drive; received_at в Pages относится к регистрации строки в браузере.

TEST идёт в отдельную папку, оба имени имеют префикс TEST_. Тестовые файлы исключаются из выборки. Незавершённые восстановленные .partial.json не являются завершёнными участниками. Отдельный withdrawal_<UUID>.csv исключает этот UUID даже при наличии ранее принятой первой CSV или промежуточной копии. Старые JSON процедуры 0.2 остаются историческими данными и не смешиваются автоматически с 0.3.

Для анализа: is_test=false, версия 0.3.0, status=complete, allow_use_after_debrief=true, media_mode=pedfe, оба файла пары, 48 основных строк, нет отметки отзыва. Ответы опроса не служат автоматическим основанием для исключения. Критерии качества и анализа задаются до проверки исследовательских результатов.

Часы устройства не используются для расчёта RT. Точность ограничена экраном, браузером и устройством ввода; запасной playing менее точно соответствует первому кадру. При перезагрузке шкала performance начинается заново — между загрузками сопоставляйте UTC-метки.
