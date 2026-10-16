export const GRID_SIZES = [4, 6, 8, 12];

export function normalizeGridSize(value) {
  if (value === "all") return "all";
  const size = Number(value);
  return GRID_SIZES.includes(size) ? size : 4;
}

export function prioritizePinned(students, pinnedStudents = {}) {
  return students
    .map((student, index) => ({ student, index }))
    .sort((a, b) => Number(Boolean(pinnedStudents[b.student.id])) - Number(Boolean(pinnedStudents[a.student.id])) || a.index - b.index)
    .map(({ student }) => student);
}

export function paginateStudents(students, page, size) {
  if (size === "all") return { page: 0, pages: 1, students };
  const pageSize = normalizeGridSize(size);
  const pages = Math.max(1, Math.ceil(students.length / pageSize));
  const currentPage = Math.max(0, Math.min(page, pages - 1));
  return { page: currentPage, pages, students: students.slice(currentPage * pageSize, currentPage * pageSize + pageSize) };
}
