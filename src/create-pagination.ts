import { IPagination, IPaginationCreatePage, IPaginationPayload, ObjectLiteral } from './interfaces';
import { Pagination } from './pagination';

const getRange = (start: number, end: number) => {
  return Array(end - start + 1)
    // @ts-ignore
    .fill()
    .map((v, i) => i + start)
}

const pages = (currentPage: number, pageCount: number) => {
  let delta: number
  if (pageCount <= 7) {
    delta = 7
  } else {
    delta = currentPage > 4 && currentPage < pageCount - 3 ? 2 : 4
  }

  const range = {
    start: Math.round(currentPage - delta / 2),
    end: Math.round(currentPage + delta / 2)
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
      url: `/?page=${page}`,
      label: String(page),
      active: page === currentPage,
      page,
    });
  })
}

const createPage = (data: IPaginationCreatePage) => {
  const { url, label, active, page } = data;

  return {
    url,
    label,
    active,
    page,
  }
}

export function createPaginationObject<
  T,
  CustomMetaType extends ObjectLiteral = IPaginationPayload,
>(data: IPagination<T>): any {
  const { currentPage, items, totalItems, limit } = data;
  const total = Math.ceil(totalItems / limit);
  const from = limit * (currentPage - 1) + 1;
  let links = [];
  const nextPage = currentPage === total ? null : currentPage + 1;
  const prevPage = currentPage === 1 ? null : currentPage - 1;
  if (prevPage) {
    links.push(createPage({
      url: `/?page=${prevPage}`,
      label: '&laquo; Previous',
      active: false,
      page: prevPage,
    }));
  }
  links = links.concat(pages(currentPage, total));
  if (nextPage) {
    links.push(createPage({
      url: `/?page=${nextPage}`,
      label: 'Next &raquo;',
      active: false,
      page: nextPage,
    }));
  }

  const payload: IPaginationPayload = {
    pagination: {
      total,
      limit,
      from,
      page: currentPage,
      links,
    },
  };

  return new Pagination<T, IPaginationPayload>(items, payload);
}
