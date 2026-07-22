-- phase17 — editor override for time-of-day ("when to arrive").
-- NULL = auto (derive from best_time_he/tips); 'morning' | 'evening' | 'any' = editor set.
-- The day-ordering engine (traits.bestTimeBucket) prefers this column when set.
alter table attractions add column if not exists time_of_day text;
