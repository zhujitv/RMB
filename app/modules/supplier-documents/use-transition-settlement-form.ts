"use client";

import { useState } from "react";
import { apiJson } from "../../api";

export type TransitionItem = {
  customsItemIndex: number;
  productName?: string;
  unit?: string;
  quantity?: string;
  quantityOptionIndex?: number | null;
  quantityOptions?: Array<{ index: number; quantity: string; unit: string }>;
  selected?: boolean;
};

export type TransitionPreview = {
  existing?: boolean;
  customsDeclarationNo?: string;
  warnings?: string[];
  increaseAmount?: string;
  decreaseAmount?: string;
  reason?: string;
  items?: TransitionItem[];
};

export function transitionSettlementValidationError(input: {
  required: boolean;
  preview: TransitionPreview | null;
  items: TransitionItem[];
  reason: string;
  confirmed: boolean;
}) {
  if (!input.required) return "";
  if (!input.preview) return "请先读取报关商品并完成历史过渡结算。";
  if (input.preview.existing) return "";
  const selected = input.items.filter((item) => item.selected);
  if (!selected.length) return "请至少勾选一行属于该工厂的报关商品。";
  if (selected.some((item) => !item.productName?.trim() || !item.unit?.trim() || !item.quantity?.trim())) {
    return "请完整填写已选商品的品名、数量和单位。";
  }
  if (input.reason.trim().length < 5) return "请填写至少5个字的过渡原因。";
  if (!input.confirmed) return "请勾选“我已核对原始凭证，确认该订单已发货报关”。";
  return "";
}

export function useTransitionSettlementForm() {
  const [preview, setPreview] = useState<TransitionPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<TransitionItem[]>([]);
  const [increaseAmount, setIncreaseAmount] = useState("0");
  const [decreaseAmount, setDecreaseAmount] = useState("0");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  function reset() {
    setPreview(null);
    setItems([]);
    setIncreaseAmount("0");
    setDecreaseAmount("0");
    setReason("");
    setConfirmed(false);
  }

  async function load(costId: string) {
    setLoading(true);
    try {
      const result = await apiJson<{ preview?: TransitionPreview }>("/api/supplier-document-requests/transition-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costId }),
      });
      const next = result.preview || {};
      setPreview(next);
      setItems((next.items || []).map((item) => ({ ...item, selected: next.existing ? true : Boolean(item.selected) })));
      setIncreaseAmount(next.increaseAmount || "0");
      setDecreaseAmount(next.decreaseAmount || "0");
      setReason(next.reason || "");
      setConfirmed(Boolean(next.existing));
    } finally {
      setLoading(false);
    }
  }

  function updateItem(index: number, patch: Partial<TransitionItem>) {
    setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  function validationError(required: boolean) {
    return transitionSettlementValidationError({ required, preview, items, reason, confirmed });
  }

  function appendFormData(formData: FormData) {
    formData.append("transitionItems", JSON.stringify(items.filter((item) => item.selected)));
    formData.append("transitionIncreaseAmount", increaseAmount || "0");
    formData.append("transitionDecreaseAmount", decreaseAmount || "0");
    formData.append("transitionReason", reason);
    formData.append("transitionConfirmed", String(confirmed));
  }

  return {
    preview, loading, items, increaseAmount, decreaseAmount, reason, confirmed,
    dirty: Boolean(preview || reason || confirmed),
    reset, load, updateItem, validationError, appendFormData,
    setIncreaseAmount, setDecreaseAmount, setReason, setConfirmed,
  };
}

export type TransitionSettlementForm = ReturnType<typeof useTransitionSettlementForm>;
