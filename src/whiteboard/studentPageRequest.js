// Page lists and teacher requests arrive independently. Consume a request only
// once its page exists locally, and leave later student navigation alone.
export function createStudentPageRequestHandler(boardToken, onPage) {
  let appliedId;
  return (request, pages) => {
    if (!request || typeof request.id !== "string" || !request.id || request.id === appliedId
      || request.boardToken !== boardToken || !pages.some((page) => page.id === request.pageId)) return false;
    onPage(request.pageId);
    appliedId = request.id;
    return true;
  };
}
