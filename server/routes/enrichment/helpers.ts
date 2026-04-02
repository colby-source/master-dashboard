export function getCompanyId(req: any): number | undefined {
  return req.query.company_id ? parseInt(req.query.company_id as string) : undefined;
}
