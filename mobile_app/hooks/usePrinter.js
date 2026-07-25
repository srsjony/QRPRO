import { useEffect, useState } from 'react';
import { getState, subscribe } from '../services/printer';

/** Live printer connection state, kept in sync with the printer service. */
export default function usePrinter() {
  const [printer, setPrinter] = useState(getState);

  useEffect(() => {
    setPrinter(getState());
    return subscribe(setPrinter);
  }, []);

  return printer;
}
