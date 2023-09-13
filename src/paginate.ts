import {
    Repository,
    SelectQueryBuilder,
    Brackets,
    FindOptionsWhere,
    FindOptionsRelations,
    ObjectLiteral,
    FindOptionsUtils,
    FindOptionsRelationByString,
} from 'typeorm'
import { PaginateQuery } from './decorator'
import { ServiceUnavailableException, Logger } from '@nestjs/common'
import { mapKeys } from 'lodash'
import { stringify } from 'querystring'
import { WherePredicateOperator } from 'typeorm/query-builder/WhereClause'
import {
    checkIsRelation,
    checkIsEmbedded,
    Column,
    extractVirtualProperty,
    fixColumnAlias,
    getPropertiesByColumnName,
    Order,
    positiveNumberOrDefault,
    RelationColumn,
    SortBy,
    includesAllPrimaryKeyColumns,
    isEntityKey,
    getQueryUrlComponents,
} from './helper'
import { addFilter, FilterOperator, FilterSuffix } from './filter'
import { OrmUtils } from 'typeorm/util/OrmUtils'

const logger: Logger = new Logger('nestjs-paginate')

export { FilterOperator, FilterSuffix }

export class Paginated<T> {
    data: T[]
    payload: {
        pagination: {
            itemsPerPage: number
            totalItems: number
            currentPage: number
            totalPages: number
            sortBy: SortBy<T>
            searchBy: Column<T>[]
            search: string
            select: string[]
            filter?: { [column: string]: string | string[] }
            links: {
                url?: string
                label?: string
                active?: boolean
                page?: number
            }[]
        }
    }
}

export enum PaginationType {
    LIMIT_AND_OFFSET = 'limit',
    TAKE_AND_SKIP = 'take',
}

export interface IPaginationCreatePage {}

export interface IPaginationCreatePage {
    url: string
    label: string
    active: boolean
    page: number
}

const createPage = (data: IPaginationCreatePage) => {
    const { url, label, active, page } = data

    return {
        url,
        label,
        active,
        page,
    }
}

const getRange = (start: number, end: number) => {
    return (
        Array(end - start + 1)
            // @ts-ignore
            .fill()
            .map((v, i) => i + start)
    )
}

export interface PaginateConfig<T> {
    relations?: FindOptionsRelations<T> | RelationColumn<T>[] | FindOptionsRelationByString
    sortableColumns: Column<T>[]
    nullSort?: 'first' | 'last'
    searchableColumns?: Column<T>[]
    select?: Column<T>[] | string[]
    maxLimit?: number
    defaultSortBy?: SortBy<T>
    defaultLimit?: number
    where?: FindOptionsWhere<T> | FindOptionsWhere<T>[]
    filterableColumns?: {
        [key in Column<T> | string]?: (FilterOperator | FilterSuffix)[] | true
    }
    loadEagerRelations?: boolean
    withDeleted?: boolean
    paginationType?: PaginationType
    relativePath?: boolean
    origin?: string
}

export const DEFAULT_MAX_LIMIT = 100
export const DEFAULT_LIMIT = 20
export const NO_PAGINATION = 0

const pages = (currentPage: number, pageCount: number, path: string, options: string) => {
    let delta: number
    if (pageCount <= 7) {
        delta = 7
    } else {
        delta = currentPage > 4 && currentPage < pageCount - 3 ? 2 : 4
    }

    const range = {
        start: Math.round(currentPage - delta / 2),
        end: Math.round(currentPage + delta / 2),
    }

    if (range.start - 1 === 1 || range.end + 1 === pageCount) {
        range.start += 1
        range.end += 1
    }

    let pages: any =
        currentPage > delta
            ? getRange(Math.min(range.start, pageCount - delta), Math.min(range.end, pageCount))
            : getRange(1, Math.min(pageCount, delta + 1))

    const withDots = (value, pair) => (pages.length + 1 !== pageCount ? pair : [value])

    if (pages[0] !== 1) {
        pages = withDots(1, [1]).concat(pages)
    }

    if (pages[pages.length - 1] < pageCount) {
        pages = pages.concat(withDots(pageCount, [pageCount]))
    }

    return pages.map((page: number) => {
        return createPage({
            url: buildLink(page, path, options),
            label: String(page),
            active: page === currentPage,
            page,
        })
    })
}

const buildLink = (p: number, path: string, options: any): string => path + '?page=' + p + options

export async function paginate<T extends ObjectLiteral>(
    query: PaginateQuery,
    repo: Repository<T> | SelectQueryBuilder<T>,
    config: PaginateConfig<T>
): Promise<Paginated<T>> {
    const page = positiveNumberOrDefault(query.page, 1, 1)

    const defaultLimit = config.defaultLimit || DEFAULT_LIMIT
    const maxLimit = positiveNumberOrDefault(config.maxLimit, DEFAULT_MAX_LIMIT)
    const queryLimit = positiveNumberOrDefault(query.limit, defaultLimit)

    const isPaginated = !(queryLimit === NO_PAGINATION && maxLimit === NO_PAGINATION)

    const limit = isPaginated ? Math.min(queryLimit || defaultLimit, maxLimit || DEFAULT_MAX_LIMIT) : NO_PAGINATION

    const sortBy = [] as SortBy<T>
    const searchBy: Column<T>[] = []

    let [items, totalItems]: [T[], number] = [[], 0]

    const queryBuilder = repo instanceof Repository ? repo.createQueryBuilder('__root') : repo

    if (repo instanceof Repository && !config.relations && config.loadEagerRelations === true) {
        if (!config.relations) {
            FindOptionsUtils.joinEagerRelations(queryBuilder, queryBuilder.alias, repo.metadata)
        }
    }

    if (isPaginated) {
        // Allow user to choose between limit/offset and take/skip.
        // However, using limit/offset can cause problems when joining one-to-many etc.
        if (config.paginationType === PaginationType.LIMIT_AND_OFFSET) {
            queryBuilder.limit(limit).offset((page - 1) * limit)
        } else {
            queryBuilder.take(limit).skip((page - 1) * limit)
        }
    }

    if (config.relations) {
        const relations = Array.isArray(config.relations)
            ? OrmUtils.propertyPathsToTruthyObject(config.relations)
            : config.relations
        const createQueryBuilderRelations = (
            prefix: string,
            relations: FindOptionsRelations<T> | RelationColumn<T>[],
            alias?: string
        ) => {
            Object.keys(relations).forEach((relationName) => {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                const relationSchema = relations![relationName]!

                queryBuilder.leftJoinAndSelect(
                    `${alias ?? prefix}.${relationName}`,
                    `${alias ?? prefix}_${relationName}_rel`
                )

                if (typeof relationSchema === 'object') {
                    createQueryBuilderRelations(relationName, relationSchema, `${alias ?? prefix}_${relationName}_rel`)
                }
            })
        }
        createQueryBuilderRelations(queryBuilder.alias, relations)
    }

    let nullSort: 'NULLS LAST' | 'NULLS FIRST' | undefined = undefined
    if (config.nullSort) {
        nullSort = config.nullSort === 'last' ? 'NULLS LAST' : 'NULLS FIRST'
    }

    if (config.sortableColumns.length < 1) {
        const message = "Missing required 'sortableColumns' config."
        logger.debug(message)
        throw new ServiceUnavailableException(message)
    }

    if (query.sortBy) {
        for (const order of query.sortBy) {
            if (isEntityKey(config.sortableColumns, order[0]) && ['ASC', 'DESC'].includes(order[1])) {
                sortBy.push(order as Order<T>)
            }
        }
    }

    if (!sortBy.length) {
        sortBy.push(...(config.defaultSortBy || [[config.sortableColumns[0], 'ASC']]))
    }

    for (const order of sortBy) {
        const columnProperties = getPropertiesByColumnName(order[0])
        const { isVirtualProperty } = extractVirtualProperty(queryBuilder, columnProperties)
        const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
        const isEmbeded = checkIsEmbedded(queryBuilder, columnProperties.propertyPath)
        let alias = fixColumnAlias(columnProperties, queryBuilder.alias, isRelation, isVirtualProperty, isEmbeded)
        if (isVirtualProperty) {
            alias = `"${alias}"`
        }
        queryBuilder.addOrderBy(alias, order[1], nullSort)
    }

    // When we partial select the columns (main or relation) we must add the primary key column otherwise
    // typeorm will not be able to map the result.
    const selectParams =
        config.select && query.select ? config.select.filter((column) => query.select.includes(column)) : config.select
    if (selectParams?.length > 0 && includesAllPrimaryKeyColumns(queryBuilder, selectParams)) {
        const cols: string[] = selectParams.reduce((cols, currentCol) => {
            const columnProperties = getPropertiesByColumnName(currentCol)
            const isRelation = checkIsRelation(queryBuilder, columnProperties.propertyPath)
            cols.push(fixColumnAlias(columnProperties, queryBuilder.alias, isRelation))
            return cols
        }, [])
        queryBuilder.select(cols)
    }

    if (config.where) {
        queryBuilder.andWhere(new Brackets((qb) => qb.andWhere(config.where)))
    }

    if (config.withDeleted) {
        queryBuilder.withDeleted()
    }

    if (config.searchableColumns) {
        if (query.searchBy) {
            for (const column of query.searchBy) {
                if (isEntityKey(config.searchableColumns, column)) {
                    searchBy.push(column)
                }
            }
        } else {
            searchBy.push(...config.searchableColumns)
        }
    }

    if (query.search && searchBy.length) {
        queryBuilder.andWhere(
            new Brackets((qb: SelectQueryBuilder<T>) => {
                for (const column of searchBy) {
                    const property = getPropertiesByColumnName(column)
                    const { isVirtualProperty, query: virtualQuery } = extractVirtualProperty(qb, property)
                    const isRelation = checkIsRelation(qb, property.propertyPath)
                    const isEmbeded = checkIsEmbedded(qb, property.propertyPath)
                    const alias = fixColumnAlias(
                        property,
                        qb.alias,
                        isRelation,
                        isVirtualProperty,
                        isEmbeded,
                        virtualQuery
                    )

                    const condition: WherePredicateOperator = {
                        operator: 'ilike',
                        parameters: [alias, `:${property.column}`],
                    }

                    if (['postgres', 'cockroachdb'].includes(queryBuilder.connection.options.type)) {
                        condition.parameters[0] = `CAST(${condition.parameters[0]} AS text)`
                    }

                    qb.orWhere(qb['createWhereConditionExpression'](condition), {
                        [property.column]: `%${query.search}%`,
                    })
                }
            })
        )
    }

    if (query.filter) {
        addFilter(queryBuilder, query, config.filterableColumns)
    }

    if (isPaginated) {
        ;[items, totalItems] = await queryBuilder.getManyAndCount()
    } else {
        items = await queryBuilder.getMany()
    }

    let path: string
    const { queryOrigin, queryPath } = getQueryUrlComponents(query.path)
    if (config.relativePath) {
        path = queryPath
    } else if (config.origin) {
        path = config.origin + queryPath
    } else {
        path = queryOrigin + queryPath
    }

    const sortByQuery = sortBy.map((order) => `&sortBy=${order.join(':')}`).join('')
    const searchQuery = query.search ? `&search=${query.search}` : ''

    const searchByQuery =
        query.searchBy && searchBy.length ? searchBy.map((column) => `&searchBy=${column}`).join('') : ''

    // Only expose select in meta data if query select differs from config select
    const isQuerySelected = selectParams?.length !== config.select?.length
    const selectQuery = isQuerySelected ? `&select=${selectParams.join(',')}` : ''

    const filterQuery = query.filter
        ? '&' +
          stringify(
              mapKeys(query.filter, (_param, name) => 'filter.' + name),
              '&',
              '=',
              { encodeURIComponent: (str) => str }
          )
        : ''

    const options = `&limit=${limit}${sortByQuery}${searchQuery}${searchByQuery}${selectQuery}${filterQuery}`

    const totalPages = isPaginated ? Math.ceil(totalItems / limit) : 1

    let links = []
    const nextPage = page === totalPages ? null : page + 1
    const prevPage = page === 1 ? null : page - 1
    if (prevPage) {
        links.push(
            createPage({
                url: buildLink(prevPage, path, options),
                label: '&laquo; Previous',
                active: false,
                page: prevPage,
            })
        )
    }
    links = links.concat(pages(page, totalPages, path, options))
    if (nextPage) {
        links.push(
            createPage({
                url: buildLink(nextPage, path, options),
                label: 'Next &raquo;',
                active: false,
                page: nextPage,
            })
        )
    }

    const results: Paginated<T> = {
        data: items,
        payload: {
            pagination: {
                itemsPerPage: isPaginated ? limit : items.length,
                totalItems: isPaginated ? totalItems : items.length,
                currentPage: page,
                totalPages,
                sortBy,
                search: query.search,
                searchBy: query.search ? searchBy : undefined,
                select: isQuerySelected ? selectParams : undefined,
                filter: query.filter,
                links,
            },
        },
    }

    return Object.assign(new Paginated<T>(), results)
}
