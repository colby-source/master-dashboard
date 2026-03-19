import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export function useCompanyFilter() {
  const [companyId, setCompanyId] = useState<number | undefined>(() => {
    const saved = localStorage.getItem('selectedCompany');
    return saved ? parseInt(saved) : undefined;
  });

  const { data: companies = [] } = useQuery({
    queryKey: ['companies'],
    queryFn: api.getCompanies,
  });

  useEffect(() => {
    if (companyId !== undefined) {
      localStorage.setItem('selectedCompany', String(companyId));
    } else {
      localStorage.removeItem('selectedCompany');
    }
  }, [companyId]);

  return { companyId, setCompanyId, companies };
}
