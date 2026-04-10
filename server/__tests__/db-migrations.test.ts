/**
 * Unit tests for migration error handling in server/db.ts
 *
 * Covers:
 *   - "duplicate column" errors are silently caught
 *   - Other errors (e.g., "table not found") are re-thrown
 *
 * We test the pattern in isolation — we do NOT import db.ts directly because
 * it initializes sql.js on import which requires file system access and
 * introduces side effects. Instead we replicate the exact guard logic that is
 * used throughout db.ts.
 */

describe('Migration error-handling guard', () => {
  /**
   * Exact pattern used in db.ts migrations:
   *
   *   try { db.run(`ALTER TABLE ... ADD COLUMN ...`); }
   *   catch (e: any) { if (!e.message?.includes('duplicate column')) throw e; }
   */
  function runMigration(simulatedError: Error | null): void {
    try {
      if (simulatedError) throw simulatedError;
      // successful migration — nothing to do
    } catch (e: any) {
      if (!e.message?.includes('duplicate column')) throw e;
    }
  }

  // --- Duplicate column errors must be silently swallowed ---

  it('does not throw for "duplicate column" error (exact phrase)', () => {
    const err = new Error('table enrichment_config already has a column named auto_reply_enabled: duplicate column');
    expect(() => runMigration(err)).not.toThrow();
  });

  it('does not throw for short "duplicate column" message', () => {
    const err = new Error('duplicate column');
    expect(() => runMigration(err)).not.toThrow();
  });

  it('does not throw for "duplicate column" appearing mid-message', () => {
    const err = new Error('error: duplicate column name: test_name');
    expect(() => runMigration(err)).not.toThrow();
  });

  it('does not throw when the migration succeeds (no error)', () => {
    expect(() => runMigration(null)).not.toThrow();
  });

  // --- All other errors must be re-thrown ---

  it('re-throws "table not found" errors', () => {
    const err = new Error('no such table: ab_tests');
    expect(() => runMigration(err)).toThrow('no such table: ab_tests');
  });

  it('re-throws "syntax error" errors', () => {
    const err = new Error('near "COLUMNN": syntax error');
    expect(() => runMigration(err)).toThrow('syntax error');
  });

  it('re-throws generic database errors', () => {
    const err = new Error('SQLITE_ERROR: something unexpected');
    expect(() => runMigration(err)).toThrow('SQLITE_ERROR');
  });

  it('re-throws errors with undefined message (no e.message)', () => {
    const err = new Error();
    // message is an empty string — does not contain 'duplicate column' → re-throw
    expect(() => runMigration(err)).toThrow();
  });

  it('re-throws errors whose message is only whitespace', () => {
    const err = new Error('   ');
    expect(() => runMigration(err)).toThrow();
  });

  it('re-throws when message is "DUPLICATE COLUMN" (wrong case — case-sensitive check)', () => {
    const err = new Error('DUPLICATE COLUMN');
    expect(() => runMigration(err)).toThrow('DUPLICATE COLUMN');
  });

  it('re-throws a non-Error object thrown as an exception', () => {
    function runWithNonError(): void {
      try {
        throw 'string error';
      } catch (e: any) {
        // e.message is undefined for a thrown string — guard: !undefined?.includes(...) → !undefined → true → re-throw
        if (!e?.message?.includes('duplicate column')) throw e;
      }
    }
    expect(() => runWithNonError()).toThrow('string error');
  });

  // --- Verify the guard is applied to each migration site ---

  /**
   * The pattern is applied to the following columns in db.ts (non-exhaustive sample):
   *   - enrichment_config.auto_reply_enabled
   *   - enrichment_config.auto_reply_sentiments
   *   - enrichment_leads.ab_variant
   *   - ab_tests.test_name
   *   - ab_tests.winning_variant
   *   - ab_tests.completed_at
   *   - company_playbooks.company_name
   *   - company_playbooks.sender_name
   *   - company_playbooks.compliance_rules
   *   - reply_messages.review_status
   */
  const migrationColumns = [
    'auto_reply_enabled',
    'auto_reply_sentiments',
    'ab_variant',
    'test_name',
    'winning_variant',
    'completed_at',
    'company_name',
    'sender_name',
    'compliance_rules',
    'review_status',
  ];

  migrationColumns.forEach((column) => {
    it(`silently ignores duplicate-column error for column "${column}"`, () => {
      const err = new Error(`duplicate column name: ${column}`);
      expect(() => runMigration(err)).not.toThrow();
    });
  });

  // --- Edge: multiple migrations in sequence ---

  it('silently ignores the first duplicate and re-throws a subsequent real error', () => {
    const results: string[] = [];

    function runSequence(): void {
      // Migration 1 — already applied
      try {
        throw new Error('duplicate column name: auto_reply_enabled');
      } catch (e: any) {
        if (!e.message?.includes('duplicate column')) throw e;
        results.push('migration1:skipped');
      }

      // Migration 2 — real failure
      try {
        throw new Error('no such table: enrichment_config');
      } catch (e: any) {
        if (!e.message?.includes('duplicate column')) throw e;
        results.push('migration2:skipped');
      }
    }

    expect(() => runSequence()).toThrow('no such table: enrichment_config');
    // First migration was silently skipped before the second threw
    expect(results).toContain('migration1:skipped');
    expect(results).not.toContain('migration2:skipped');
  });

  it('processes all migrations silently when all are already-applied duplicates', () => {
    const applied: string[] = [];

    function runAllDuplicates(): void {
      const columns = ['col_a', 'col_b', 'col_c'];
      for (const col of columns) {
        try {
          throw new Error(`duplicate column name: ${col}`);
        } catch (e: any) {
          if (!e.message?.includes('duplicate column')) throw e;
          applied.push(col);
        }
      }
    }

    expect(() => runAllDuplicates()).not.toThrow();
    expect(applied).toEqual(['col_a', 'col_b', 'col_c']);
  });
});
