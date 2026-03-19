import { createContext, useContext } from "react"

interface CompanyContextValue {
  companyId: number | undefined
  setCompanyId: (id: number | undefined) => void
  companies: any[]
}

export const CompanyContext = createContext<CompanyContextValue>({
  companyId: undefined,
  setCompanyId: () => {},
  companies: [],
})

export function useCompany() {
  return useContext(CompanyContext)
}
