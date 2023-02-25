import { IPaginationPayload, ObjectLiteral } from './interfaces';

export class Pagination<
  PaginationObject,
  T extends ObjectLiteral = IPaginationPayload,
> {
  constructor(
    /**
     * a list of items to be returned
     */
    public readonly items: PaginationObject[],
    /**
     * associated meta information (e.g., counts)
     */
    public readonly payload: T,
  ) {}
}
