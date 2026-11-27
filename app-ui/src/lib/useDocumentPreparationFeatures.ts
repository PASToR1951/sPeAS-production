import { useEffect, useState } from "react";
import { apiFetch } from "./api/http";
export function useDocumentPreparationFeatures() {
  const [features, setFeatures] = useState({
    imports: false,
    volumeReader: false,
    loaded: false,
  });
  useEffect(() => {
    let active = true;
    void apiFetch<typeof features>("/api/features/document-preparation").then(
      (data) => {
        if (active) {
          setFeatures({
            imports: data.imports === true,
            volumeReader: data.volumeReader === true,
            loaded: true,
          });
        }
      },
    ).catch(() => { if (active) setFeatures((current) => ({ ...current, loaded: true })); });
    return () => {
      active = false;
    };
  }, []);
  return features;
}
