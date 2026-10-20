
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config/app_config.dart';
import '../models/product_model.dart';

class PaymentService {
  final _db = Supabase.instance.client;

  Future<List<Product>> fetchProducts() async {
    final rows = await _db.from('products').select();

    return rows.map<Product>((r) => Product.fromMap(r)).toList();
  }

  Future<String> createOrderAndInvoice(Product product) async {
    final res = await _db.functions.invoke(
      AppConfig.createInvoiceFunction,
      body: {
        'product_id': product.id,
      },
    );

    final data = res.data;

    if (res.status < 200 ||
        res.status >= 300 ||
        data is! Map<String, dynamic>) {
      throw Exception('Hindi makagawa ng payment invoice.');
    }

    final url = data['checkout_url'] as String?;

    if (url == null || url.isEmpty) {
      throw Exception('Walang checkout URL na ibinalik.');
    }

    return url;
  }

  Future<List<Map<String, dynamic>>> fetchOrders() async {
    final rows = await _db
        .from('orders')
        .select()
        .order('created_at', ascending: false);

    return List<Map<String, dynamic>>.from(rows);
  }
}
