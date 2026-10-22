import { useEffect, useState } from "react";
import { apiFetch } from "./api/http";
export function useDocumentPreparationFeatures() {
  const [features, setFeatures] = useState({
    imports: false,
    volumeReader: false,
  });
  useEffect(() => {
    let active = true;
    void apiFetch<typeof features>("/api/features/document-preparation").then(
      (data) => {
        if (active) {
          setFeatures({
            imports: data.imports === true,
            volumeReader: data.volumeReader === true,
          });
        }
      },
    ).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  return features;
}
