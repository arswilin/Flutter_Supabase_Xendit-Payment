import { createClient } from "npm:@supabase/supabase-js@2";

const SUCCESS_URL = "https://xendit.co/success";
const FAILURE_URL = "https://xendit.co/failure";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const xenditKey = Deno.env.get("XENDIT_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!xenditKey || !supabaseUrl || !serviceKey) {
    return json({ error: "Server configuration error" }, 500);
  }

  let productId: number;
  try {
    const body = await req.json();
    productId = Number(body.product_id);
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!Number.isInteger(productId) || productId <= 0) {
    return json({ error: "product_id is required" }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, name, price")
    .eq("id", productId)
    .maybeSingle();
  if (productError || !product) return json({ error: "Product not found" }, 404);

  const amount = Number(product.price);
  const externalId = `order-${crypto.randomUUID()}`;

  const { data: order, error: insertError } = await supabase
    .from("orders")
    .insert({
      external_id: externalId,
      product_name: product.name,
      amount,
      status: "PENDING",
    })
    .select("id, external_id")
    .single();
  if (insertError || !order) {
    console.error("Order insert error:", insertError);
    return json({ error: "Could not create order", detail: insertError?.message }, 500);
  }

  const xenditRes = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${xenditKey}:`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: externalId,
      amount,
      currency: "PHP",
      description: `Order: ${product.name}`,
      success_redirect_url: SUCCESS_URL,
      failure_redirect_url: FAILURE_URL,
    }),
  });

  const invoice = await xenditRes.json().catch(() => null);
  if (!xenditRes.ok || !invoice) {
    console.error("Xendit error:", xenditRes.status, invoice);
    await supabase.from("orders").update({ status: "FAILED" }).eq("id", order.id);
    return json({ error: "Could not create invoice", xendit: invoice }, 502);
  }

  return json({
    order_id: order.id,
    external_id: order.external_id,
    amount,
    checkout_url: invoice.invoice_url,
  });
});