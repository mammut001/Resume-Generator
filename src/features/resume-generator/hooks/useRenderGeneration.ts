import { useCallback, useEffect, useRef } from 'react';

export function useRenderGeneration() {
  const generationRef = useRef(0);

  const nextGeneration = useCallback(() => {
    generationRef.current += 1;
    return generationRef.current;
  }, []);

  const isCurrentGeneration = useCallback((generation: number) => generation === generationRef.current, []);

  const invalidate = useCallback(() => {
    generationRef.current += 1;
  }, []);

  useEffect(() => () => {
    generationRef.current += 1;
  }, []);

  return { nextGeneration, isCurrentGeneration, invalidate };
}