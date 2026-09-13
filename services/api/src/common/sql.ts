/**
 * A minimal parameterised WHERE builder.
 *
 * Every value becomes a bind parameter; the builder has no way to interpolate one
 * into the SQL text, so a call site cannot accidentally produce an injectable
 * query even under refactoring. Column fragments are written by the call site and
 * are never derived from request input.
 */
export class WhereBuilder {
  private readonly clauses: string[] = [];
  private readonly values: unknown[] = [];

  /**
   * Add a clause. Write `?` for each bind placeholder, in order, and supply the
   * matching values: `add('(a = ? OR b = ?)', value, value)`.
   */
  add(fragment: string, ...values: unknown[]): this {
    const expected = (fragment.match(/\?/g) ?? []).length;
    if (expected !== values.length) {
      throw new Error(
        `WhereBuilder: fragment expects ${expected} values but ${values.length} were supplied`,
      );
    }
    let index = 0;
    const rendered = fragment.replace(/\?/g, () => {
      this.values.push(values[index]);
      index += 1;
      return `$${this.values.length}`;
    });
    this.clauses.push(rendered);
    return this;
  }

  /** Add a clause with no bind parameters. */
  addRaw(fragment: string): this {
    this.clauses.push(fragment);
    return this;
  }

  get sql(): string {
    return this.clauses.length === 0 ? '' : `WHERE ${this.clauses.join(' AND ')}`;
  }

  get params(): readonly unknown[] {
    return this.values;
  }

  /** Next bind index, for LIMIT/OFFSET appended after the WHERE clause. */
  next(offset = 1): number {
    return this.values.length + offset;
  }

  withExtra(...extra: unknown[]): unknown[] {
    return [...this.values, ...extra];
  }
}
