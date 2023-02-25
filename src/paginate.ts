import {
  FindManyOptions,
  FindOptionsWhere,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { createPaginationObject } from './create-pagination';
import {
  IPaginationOptions,
  PaginationTypeEnum,
  TypeORMCacheType,
} from './interfaces';

const DEFAULT_LIMIT = 10;
const DEFAULT_PAGE = 1;

export async function paginate<T>(
  repositoryOrQueryBuilder: Repository<T> | SelectQueryBuilder<T>,
  options: IPaginationOptions,
  searchOptions?: FindOptionsWhere<T> | FindManyOptions<T>,
) {
  if (repositoryOrQueryBuilder instanceof Repository) {
    return paginateRepository<T>(
      repositoryOrQueryBuilder,
      options,
      searchOptions,
    );
  } else {
    return paginateQueryBuilder<T>(repositoryOrQueryBuilder, options);
  }
}

async function paginateRepository<T>(
  repository: Repository<T>,
  options: IPaginationOptions,
  searchOptions?: FindOptionsWhere<T> | FindManyOptions<T>,
) {
  const [page, limit, paginationType, countQueries] = resolveOptions(options);
  if (page < 1) {
    return createPaginationObject({
      items: [],
      totalItems: 0,
      currentPage: page,
      limit,
    });
  }

  const [items, totalItems] = await repository.findAndCount({
    skip: limit * (page - 1),
    take: limit,
    ...searchOptions,
  });

  return createPaginationObject({
    items,
    totalItems,
    currentPage: page,
    limit,
  });
}

const paginateQueryBuilder = async <T>(
  queryBuilder: SelectQueryBuilder<T>,
  options: IPaginationOptions,
) => {
  const [page, limit, paginationType, countQueries] = resolveOptions(options);

  const promises: [Promise<T[]>, Promise<number> | undefined] = [
    (PaginationTypeEnum.LIMIT_AND_OFFSET === paginationType
      ? queryBuilder.limit(limit).offset((page - 1) * limit)
      : queryBuilder.take(limit).skip((page - 1) * limit)
    ).getMany(),
    undefined,
  ];

  promises[1] = countQuery(queryBuilder);

  const [items, totalItems] = await Promise.all(promises);

  return createPaginationObject({
    items,
    totalItems,
    currentPage: page,
    limit,
  });
};

const countQuery = async <T>(
  queryBuilder: SelectQueryBuilder<T>,
): Promise<number> => {
  const totalQueryBuilder = queryBuilder.clone();

  totalQueryBuilder
    .skip(undefined)
    .limit(undefined)
    .offset(undefined)
    .take(undefined)
    .orderBy(undefined);

  const { value } = await queryBuilder.connection
    .createQueryBuilder()
    .select('COUNT(*)', 'value')
    .from(`(${totalQueryBuilder.getQuery()})`, 'uniqueTableAlias')
    .setParameters(queryBuilder.getParameters())
    .getRawOne<{ value: string }>();

  return Number(value);
};

const resolveOptions = (
  options: IPaginationOptions<any>,
): [number, number, PaginationTypeEnum, TypeORMCacheType] => {
  const page = resolveNumericOption(options, 'page', DEFAULT_PAGE);
  const limit = resolveNumericOption(options, 'limit', DEFAULT_LIMIT);
  const paginationType =
    options.paginationType || PaginationTypeEnum.LIMIT_AND_OFFSET;
  const cacheQueries = options.cacheQueries || false;

  return [page, limit, paginationType, cacheQueries];
};

const resolveNumericOption = (
  options: IPaginationOptions,
  key: 'page' | 'limit',
  defaultValue: number,
) => {
  const value = options[key];
  const resolvedValue = Number(value);
  if (Number.isInteger(resolvedValue) && resolvedValue >= 0) {
    return resolvedValue;
  }

  return defaultValue;
};
