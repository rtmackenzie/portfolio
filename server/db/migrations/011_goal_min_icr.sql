ALTER TABLE goals RENAME COLUMN min_dscr TO min_icr;
UPDATE goals SET min_icr = NULL;
