export enum PaginationTypeEnum {
  LIMIT_AND_OFFSET = 'limit',
  TAKE_AND_SKIP = 'take',
}

export interface IPagination<T> {
  items: T[];
  totalItems?: number;
  limit?: number;
  currentPage?: number;
}

export interface IPaginationCreatePage {
  url: string;
  label: string;
  active: boolean;
  page: number;
}

export interface IPaginationOptions<CustomMetaType = IPaginationPayload> {
  /**
   * @default 10
   * the amount of items to be requested per page
   */
  limit: number | string;

  /**
   * @default 1
   * the page that is requested
   */
  page: number | string;

  /**
   * @default PaginationTypeEnum.LIMIT
   * Used for changing query method to take/skip (defaults to limit/offset if no argument supplied)
   */
  paginationType?: PaginationTypeEnum;

  /**
   * @default false
   * @link https://orkhan.gitbook.io/typeorm/docs/caching
   *
   * Enables or disables query result caching.
   */
  cacheQueries?: TypeORMCacheType;
}

export type TypeORMCacheType =
  | boolean
  | number
  | {
      id: any;
      milliseconds: number;
    };

export interface ObjectLiteral {
  [s: string]: any;
}

export interface IPaginationPayloadLinks extends ObjectLiteral {
  url: string;
  label: number;
  active: boolean;
  page: number;
}

export interface IPaginationPayloadMain extends ObjectLiteral {
  page?: number;
  limit?: number;
  from?: number;
  total?: number;
  links?: IPaginationPayloadLinks[];
}

export interface IPaginationPayload extends ObjectLiteral {
  pagination: IPaginationPayloadMain;
}
