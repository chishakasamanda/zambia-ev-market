const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "../client")));
app.use("/Images", express.static(path.join(__dirname, "../client/Images")));

console.log("Images folder:", path.join(__dirname, "../client/Images"));
const SECRET = "secretkey";

// ================= IMAGE =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../client/Images");

    console.log("Saving to:", dir); // ✅ ADD HERE

    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});
const upload = multer({ storage });

// ================= DB =================
const db = mysql.createConnection({
  host: "localhost",
  user: "root",
  password: "Cherrybubblegum@5",
  database: "zambia_ev_landscape"
});

db.connect(err => {
  if (err) console.log("DB ERROR:", err);
  else console.log("✅ Connected to MySQL");
});

// ================= AUTH =================
function verifyToken(req, res, next) {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(403).json({ message: "No token provided" });
  }

  const token = header.split(" ")[1];

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Invalid token" });
    }

    req.user = decoded; // ✅ THIS LINE IS CRITICAL
    next();
  });
}
// ================= REGISTER =================
app.post("/api/register", async (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role)
    return res.status(400).json({ message: "All fields required" });

  const hash = await bcrypt.hash(password, 10);

  db.query(
    "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
    [name, email, hash, role],
    (err) => {
      if (err) return res.status(400).json({ message: "User exists" });
      res.json({ message: "Registered successfully" });
    }
  );
});

// ================= LOGIN =================
app.post("/api/login", (req, res) => {
  const { email, password } = req.body;

  db.query("SELECT * FROM users WHERE email=?", [email], async (err, result) => {

  if (err) {
    console.log(err);
    return res.status(500).json({ message: "DB error" });
  }

  if (result.length === 0)
      return res.status(400).json({ message: "User not found" });

    const user = result[0];

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ message: "Wrong password" });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      SECRET,
      { expiresIn: "1d" }
    );

    res.json({ token, role: user.role, name: user.name });
  });
});

// ================= USER =================
app.get("/api/me", verifyToken, (req, res) => {
  db.query(
    "SELECT name FROM users WHERE id=?",
    [req.user.id], // ✅ NOT req.userId
    (err, result) => res.json(result[0])
  );
});

// ================= PRODUCTS =================

// ALL PRODUCTS
app.get("/api/products", verifyToken, (req, res) => {
  db.query(
    `SELECT p.*, u.name AS seller_name, u.phone, u.address
     FROM products p
JOIN users u ON p.seller_id=u.id`,
(err, products) => {

  if (err) {
    console.log(err);
    return res.status(500).json({ message: "DB error" });
  }
      if (products.length === 0) return res.json([]);

      const ids = products.map(p => p.id);

      db.query(
        "SELECT * FROM product_images WHERE product_id IN (?)",
        [ids],
       (err, images) => {

  if (err) {
    console.log(err);
    return res.status(500).json({ message: "DB error" });
  }

          products.forEach(p => {
            p.images = images
              .filter(img => img.product_id === p.id)
              .map(img => img.image_url);
          });

          res.json(products);
        }
      );
    }
  );
});


//messages
app.post("/api/messages/image", verifyToken, upload.single("image"), (req, res) => {

let { receiver_id, product_id } = req.body;

if (!receiver_id || receiver_id === "null") {
  return res.status(400).json({ message: "Invalid receiver_id" });
}

  if (!req.file) {
    return res.status(400).json({ message: "No image uploaded" });
  }

  const imageUrl = "/Images/" + req.file.filename;

  db.query(
    "INSERT INTO messages (sender_id, receiver_id, message, image_url, product_id) VALUES (?,?,?,?,?)",
    [req.user.id, receiver_id, null, imageUrl, product_id || null],
    (err) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Upload failed" });
      }

      res.json({ message: "Image sent", image_url: imageUrl });
    }
  );
});

// ================= SELLER OWN PRODUCTS =================
app.get("/api/my-products", verifyToken, (req, res) => {

  if (req.user.role !== "seller") {
    return res.status(403).json({ message: "Only sellers allowed" });
  }

  db.query(
    "SELECT * FROM products WHERE seller_id=?",
    [req.user.id],
    (err, products) => {

      if (err) return res.status(500).json({ message: "DB error" });

      if (products.length === 0) return res.json([]);

      const ids = products.map(p => p.id);

      db.query(
        "SELECT * FROM product_images WHERE product_id IN (?)",
        [ids],
        (err, images) => {

          if (err) return res.status(500).json({ message: "DB error" });

          products.forEach(p => {
            p.images = images
              .filter(img => img.product_id === p.id)
              .map(img => img.image_url);
          });

          res.json(products);
        }
      );
    }
  );
});

// SINGLE PRODUCT
app.get("/api/products/:id", verifyToken, (req, res) => {
  db.query(
    `SELECT p.*, u.name AS seller_name, u.phone, u.address
     FROM products p
     JOIN users u ON p.seller_id=u.id
     WHERE p.id=?`,
    [req.params.id],
   (err, result) => {

  if (err) {
    console.log(err);
    return res.status(500).json({ message: "DB error" });
  }
      if (result.length === 0) return res.json({});
      res.json(result[0]);
    }
  );
});

// ADD PRODUCT
app.post("/api/products", verifyToken, upload.array("images", 5), (req, res) => {
  console.log("ADD PRODUCT HIT");
  console.log("BODY:", req.body);
  console.log("FILES:", req.files);
  console.log("USER:", req.user);

  if (req.user.role !== "seller")
    return res.status(403).json({ message: "Only sellers allowed" });

  // ✅ FIRST declare variables
  const { name, price, stock, description, category } = req.body;

  // ✅ THEN validate
  if (!name || !price) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // ✅ THEN process
const fixedPrice = parseFloat(price);

if (isNaN(fixedPrice)) {
  return res.status(400).json({ message: "Invalid price" });
}
  const fixedStock = Number(stock) || 0;

  const files = req.files || [];

  const mainImage = files.length > 0
    ? "/Images/" + files[0].filename
    : "";

  db.query(
  "INSERT INTO products (name,description,price,stock,category,image_url,seller_id) VALUES (?,?,?,?,?,?,?)",
  [name, description, fixedPrice, fixedStock,category, mainImage, req.user.id],
  (err, result) => {

    if (err) {
      console.log("INSERT ERROR:", err); // ✅ THIS LINE
      return res.status(500).json({ message: "Insert failed" });
    }

    const productId = result.insertId;

    const imageValues = files.map(file => [
      productId,
      "/Images/" + file.filename
    ]);

    if (imageValues.length > 0) {
      db.query(
        "INSERT INTO product_images (product_id,image_url) VALUES ?",
        [imageValues],
        () => res.json({ message: "Product added" })
      );
    } else {
      res.json({ message: "Product added" });
    }
  }
);
});
// ================= UPDATE PRODUCT =================
app.put("/api/products/:id", verifyToken, upload.single("image"), (req, res) => {

  if (req.user.role !== "seller")
    return res.status(403).json({ message: "Only sellers allowed" });

  const { name, description, price, stock } = req.body;

  // check if new image uploaded
  let imageQueryPart = "";
  let values = [name, description, price, stock];

  if (req.file) {
    const image = `/Images/${req.file.filename}`;
    imageQueryPart = ", image_url=?";
    values.push(image);
  }

  values.push(req.params.id, req.user.id);

  const sql = `
    UPDATE products 
    SET name=?, description=?, price=?, stock=? ${imageQueryPart}
    WHERE id=? AND seller_id=?
  `;

  db.query(sql, values, (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Update failed" });
    }

    res.json({ message: "Product updated" });
  });
});
// ================= DELETE PRODUCT =================
app.delete("/api/products/:id", verifyToken, (req, res) => {

  if (req.user.role !== "seller")
    return res.status(403).json({ message: "Only sellers allowed" });

  const id = req.params.id;

  console.log("DELETE REQUEST =>", {
    productId: id,
    userId: req.user.id,
    role: req.user.role
  });

  // STEP 1: verify ownership FIRST (important fix)
  db.query(
    "SELECT seller_id FROM products WHERE id=?",
    [id],
    (err, result) => {

      if (err) {
        console.log("DB error:", err);
        return res.status(500).json({ message: "DB error" });
      }

      if (result.length === 0) {
        return res.status(404).json({ message: "Product not found" });
      }

      const ownerId = result[0].seller_id;

      if (Number(ownerId) !== Number(req.user.id)) {
        return res.status(403).json({
          message: "Ownership mismatch (not your product)"
        });
      }

      // STEP 2: delete images
      db.query(
        "DELETE FROM product_images WHERE product_id=?",
        [id],
        () => {

          // STEP 3: delete product
          db.query(
            "DELETE FROM products WHERE id=?",
            [id],
            (err, result) => {

              if (err) {
                console.log("DELETE ERROR:", err);
                return res.status(500).json({ message: "Delete failed" });
              }

              res.json({ message: "Product deleted successfully" });
            }
          );
        }
      );
    }
  );
});
// ================= WISHLIST =================

// ADD
app.post("/api/wishlist/add", verifyToken, (req, res) => {
  const { product_id } = req.body;

  db.query(
    "SELECT * FROM wishlist WHERE user_id=? AND product_id=?",
    [req.user.id, product_id],
    (err, result) => {

      if (result.length > 0)
        return res.json({ message: "Already in wishlist" });

      db.query(
        "INSERT INTO wishlist (user_id,product_id) VALUES (?,?)",
        [req.user.id, product_id],
        () => res.json({ message: "Added to wishlist" })
      );
    }
  );
});

// GET
app.get("/api/wishlist", verifyToken, (req, res) => {
  db.query(
    `SELECT p.* FROM wishlist w
     JOIN products p ON w.product_id=p.id
     WHERE w.user_id=?`,
    [req.user.id],
    (err, result) => res.json(result)
  );
});
app.post("/api/wishlist/remove", verifyToken, (req, res) => {
  const { product_id } = req.body;

  db.query(
    "DELETE FROM wishlist WHERE user_id=? AND product_id=?",
    [req.user.id, product_id],
    (err) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "Delete failed" });
      }

      res.json({ message: "Removed from wishlist" });
    }
  );
});

// ================= CART =================

// ADD
app.post("/api/cart/add", verifyToken, (req, res) => {
  const { product_id } = req.body;

  db.query(
    "SELECT * FROM cart WHERE user_id=? AND product_id=?",
    [req.user.id, product_id],
    (err, result) => {

      if (result.length > 0) {
        db.query(
          "UPDATE cart SET quantity=quantity+1 WHERE user_id=? AND product_id=?",
          [req.user.id, product_id],
          () => res.json({ message: "Updated" })
        );
      } else {
        db.query(
          "INSERT INTO cart VALUES (NULL,?,?,1)",
          [req.user.id, product_id],
          () => res.json({ message: "Added" })
        );
      }
    }
  );
});

// GET
app.get("/api/cart", verifyToken, (req, res) => {
  db.query(
    `SELECT c.quantity, p.* FROM cart c
     JOIN products p ON c.product_id=p.id
     WHERE c.user_id=?`,
    [req.user.id],
    (err, result) => res.json(result)
  );
});
//Checkout/////
app.post("/api/checkout", verifyToken, (req, res) => {
  const { name, phone, address } = req.body;

  if (!name || !phone || !address) {
    return res.status(400).json({ message: "Missing details" });
  }

db.query(
  `SELECT c.quantity, p.price, p.id as product_id
   FROM cart c
   JOIN products p ON c.product_id = p.id
   WHERE c.user_id=?`,
  [req.user.id],
  (err, results) => {

    if (err) return res.status(500).json({ message: "DB error" });

const cartItems = results || [];

if (cartItems.length === 0) {
  return res.status(400).json({ message: "Cart is empty" });
}

const total = cartItems.reduce((sum, item) => {
  return sum + (item.price * item.quantity);
}, 0);

db.query(
  "INSERT INTO orders (user_id, name, phone, address, status, total_amount) VALUES (?,?,?,?,?,?)",
  [req.user.id, name, phone, address, "pending", total],
        (err, orderResult) => {
          if (err) return res.status(500).json({ message: "Order failed" });

          const orderId = orderResult.insertId;

          const values = cartItems.map(item => [
            orderId,
            item.product_id,
            item.quantity
          ]);

          db.query(
            "INSERT INTO order_items (order_id, product_id, quantity) VALUES ?",
            [values],
            () => {
              db.query(
                "DELETE FROM cart WHERE user_id=?",
                [req.user.id],
                () => {
                  res.json({ message: "COD Order placed", orderId });
                }
              );
            }
          );
        }
      );
    }
  );
});

// UPDATE
app.put("/api/cart/update", verifyToken, (req, res) => {
  const { product_id, quantity } = req.body;

  if (quantity <= 0) {
    db.query(
      "DELETE FROM cart WHERE user_id=? AND product_id=?",
      [req.user.id, product_id],
      () => res.json({ message: "Removed" })
    );
  } else {
    db.query(
      "UPDATE cart SET quantity=? WHERE user_id=? AND product_id=?",
      [quantity, req.user.id, product_id],
      () => res.json({ message: "Updated" })
    );
  }
});

// ================= BUYER ORDERS =================
app.get("/api/orders", verifyToken, (req, res) => {

  const sql = `
    SELECT 
      o.id,
      o.name,
      o.phone,
      o.address,
      o.status,
      o.created_at,
      SUM(oi.quantity) AS items
    FROM orders o
    JOIN order_items oi ON o.id = oi.order_id
    WHERE o.user_id = ?
    GROUP BY o.id
    ORDER BY o.id DESC
    LIMIT 1
  `;

  db.query(sql, [req.user.id], (err, result) => {
    if (err) return res.status(500).json([]);
    res.json(result[0] || {});
  });

});

// ================= UPDATE ORDER ADDRESS =================
app.put("/api/orders/:id", verifyToken, (req, res) => {

  const { name, phone, address } = req.body;

  db.query(
    "UPDATE orders SET name=?, phone=?, address=? WHERE id=? AND user_id=?",
    [name, phone, address, req.params.id, req.user.id],
    (err) => {
      if (err) return res.status(500).json({ message: "Update failed" });
      res.json({ message: "Updated" });
    }
  );

});

// ================= REVIEWS =================
app.post("/api/reviews", verifyToken, (req, res) => {
  const { product_id, rating, comment } = req.body;

  db.query(
    "SELECT * FROM reviews WHERE user_id=? AND product_id=?",
    [req.user.id, product_id],
    (err, result) => {

      if (result.length > 0) {
        db.query(
          "UPDATE reviews SET rating=?, comment=? WHERE user_id=? AND product_id=?",
          [rating, comment, req.user.id, product_id],
          () => res.json({ message: "Updated" })
        );
      } else {
        db.query(
          "INSERT INTO reviews (user_id,product_id,rating,comment) VALUES (?,?,?,?)",
          [req.user.id, product_id, rating, comment],
          () => res.json({ message: "Added" })
        );
      }
    }
  );
});

app.get("/api/reviews/:id", verifyToken, (req, res) => {
  db.query(
    `SELECT r.*, u.name FROM reviews r
     JOIN users u ON r.user_id=u.id
     WHERE r.product_id=?`,
    [req.params.id],
    (err, result) => res.json(result)
  );
});

app.get("/api/recently-viewed", verifyToken, (req, res) => {

  const sql = `
    SELECT p.*
    FROM recently_viewed rv
    JOIN products p ON rv.product_id = p.id
    WHERE rv.user_id=?
    ORDER BY rv.viewed_at DESC
    LIMIT 6
  `;

  db.query(sql, [req.user.id], (err, result) => {
    if(err){
      console.log(err);
      return res.status(500).json([]);
    }
    res.json(result);
  });

});
// ================= CHARGING STATIONS =================

// GET ALL STATIONS
app.get("/api/stations", (req, res) => {

  db.query(
    "SELECT * FROM charging_stations",
    (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ message: "DB error" });
      }

      res.json(result);
    }
  );
});

// ================= RECENTLY VIEWED =================
app.post("/api/recently-viewed", verifyToken, (req, res) => {

  const { product_id } = req.body;

  console.log("RECENT VIEW HIT =>", {
    user: req.user.id,
    product: product_id
  });

  db.query(
    "REPLACE INTO recently_viewed (user_id,product_id) VALUES (?,?)",
    [req.user.id, product_id],
    (err, result) => {

      if(err){
        console.log("RECENT VIEW ERROR:", err);
        return res.status(500).json({ message: "DB error" });
      }

      console.log("RECENT VIEW SAVED ✅");

      res.json({ message: "Saved" });
    }
  );
});

// ================= BEST PRODUCT =================
app.get("/api/seller/best-product", verifyToken, (req, res) => {

  const sql = `
    SELECT p.*,
    COUNT(DISTINCT w.id) AS wishlist_count,
    COUNT(DISTINCT c.id) AS cart_count,
    (COUNT(DISTINCT w.id) + COUNT(DISTINCT c.id)) AS score
    FROM products p
    LEFT JOIN wishlist w ON p.id = w.product_id
    LEFT JOIN cart c ON p.id = c.product_id
    WHERE p.seller_id=?
    GROUP BY p.id
    ORDER BY score DESC
    LIMIT 1
  `;

  db.query(sql, [req.user.id], (err, result) => {
    if (result.length === 0)
      return res.json({ message: "No data" });

    res.json(result[0]);
  });
});

// ================= DASHBOARD STATS =================
app.get("/api/seller/dashboard-stats", verifyToken, (req, res) => {

  const sql = `
    SELECT 
      COUNT(DISTINCT p.id) AS total_products,
      SUM(p.stock) AS total_stock,
      COUNT(DISTINCT w.id) AS wishlist_total,
      COUNT(DISTINCT c.id) AS cart_total
    FROM products p
    LEFT JOIN wishlist w ON p.id = w.product_id
    LEFT JOIN cart c ON p.id = c.product_id
    WHERE p.seller_id = ?
  `;

  db.query(sql, [req.user.id], (err, result) => {
    res.json(result[0]);
  });
});

// ================= SELLER ORDERS =================
app.get("/api/seller/orders", verifyToken, (req, res) => {

  if (req.user.role !== "seller") {
    return res.status(403).json({ message: "Only sellers allowed" });
  }

  const sellerId = req.user.id;

  const sql = `
SELECT 
  o.id,
  o.name AS buyer_name,
  o.phone,
  o.address,
  o.status,
  SUM(oi.quantity) AS items,
  SUM(oi.quantity * p.price) AS total 
FROM order_items oi
JOIN orders o ON oi.order_id = o.id
JOIN products p ON oi.product_id = p.id
WHERE p.seller_id = ?
GROUP BY o.id
ORDER BY o.id DESC
  `;

  db.query(sql, [sellerId], (err, rows) => {
    if (err) {
      console.log("ORDER ERROR:", err);
      return res.status(500).json({ message: "Failed to load orders" });
    }
    res.json(rows);
  });
});
app.get("/api/seller/chats", verifyToken, (req, res) => {

  if (req.user.role !== "seller") {
    return res.status(403).json([]);
  }

  const sellerId = req.user.id;

  const sql = `
    SELECT 
      m.sender_id AS buyer_id,
      u.name AS buyer_name,
      m.product_id,
      p.name AS product_name,
      MAX(m.created_at) AS updated_at,
      SUBSTRING_INDEX(GROUP_CONCAT(m.message ORDER BY m.created_at DESC), ',', 1) AS last_message
    FROM messages m
    JOIN users u ON m.sender_id = u.id
    LEFT JOIN products p ON m.product_id = p.id
    WHERE m.receiver_id = ?
    GROUP BY m.sender_id, m.product_id
    ORDER BY updated_at DESC
  `;

  db.query(sql, [sellerId], (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json([]);
    }

    res.json(result);
  });
});
app.get("/api/buyer/chats", verifyToken, (req, res) => {

  if (req.user.role !== "buyer") {
    return res.status(403).json([]);
  }

  const buyerId = req.user.id;

  const sql = `
    SELECT 
      m.receiver_id AS seller_id,
      u.name AS seller_name,
      m.product_id,
      p.name AS product_name,
      MAX(m.created_at) AS updated_at,
      SUBSTRING_INDEX(GROUP_CONCAT(m.message ORDER BY m.created_at DESC), ',', 1) AS last_message
    FROM messages m
    JOIN users u ON m.receiver_id = u.id
    LEFT JOIN products p ON m.product_id = p.id
    WHERE m.sender_id = ?
    GROUP BY m.receiver_id, m.product_id
    ORDER BY updated_at DESC
  `;

  db.query(sql, [buyerId], (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json([]);
    }

    res.json(result);
  });
});

app.post("/api/messages", verifyToken, (req, res) => {

  const { receiver_id, message, product_id } = req.body;

  if (!receiver_id) {
    return res.status(400).json({ message: "receiver required" });
  }

  db.query(
    `INSERT INTO messages (sender_id, receiver_id, message, product_id, created_at)
     VALUES (?,?,?,?,NOW())`,
    [req.user.id, receiver_id, message || null, product_id || null],
    (err) => {
      if (err) return res.status(500).send(err);
      res.json({ success: true });
    }
  );
});

app.get("/api/messages/:id", verifyToken, (req, res) => {

    if (!req.params.id) {
    return res.status(400).json([]);
  }

  const otherUser = req.params.id;

  const sql = `
    SELECT m.*, p.name AS product_name
    FROM messages m
    LEFT JOIN products p ON m.product_id = p.id
    WHERE (m.sender_id=? AND m.receiver_id=?)
       OR (m.sender_id=? AND m.receiver_id=?)
    ORDER BY m.created_at ASC
  `;

  db.query(
    sql,
    [req.user.id, otherUser, otherUser, req.user.id],
    (err, result) => {
      if (err) return res.status(500).json([]);
      res.json(result);
    }
  );
});

app.get("/api/seller/profile", verifyToken, (req, res) => { 
  const userId = req.user.id;

  db.query(
    `SELECT 
      name, 
      phone, 
      shop_name, 
      profile_image,
      verification_doc,
      category,
      description,
      location,
      status
     FROM users 
     WHERE id=?`,
    [userId],
    (err, result) => {

      if (err) {
        console.log(err);
        return res.status(500).json({ message: "DB error" });
      }

      res.json(result[0] || {});
    }
  );
});

app.put("/api/seller/profile", verifyToken, upload.fields([
  { name: "profile_image", maxCount: 1 },
  { name: "verification_doc", maxCount: 1 }
]), (req, res) => {

  const userId = req.user.id;
const { name, phone, shop_name, category, description, location } = req.body;

  // ✅ validation
  if (!name || !shop_name || !phone) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  // ✅ safe file handling
  const profileImage = req.files && req.files["profile_image"]
    ? `/Images/${req.files["profile_image"][0].filename}`
    : null;

  const verificationDoc = req.files && req.files["verification_doc"]
    ? `/Images/${req.files["verification_doc"][0].filename}`
    : null;

let sql = `
  UPDATE users 
  SET name=?, phone=?, shop_name=?, category=?, description=?, location=?
`;

let values = [name, phone, shop_name, category, description, location];

if (profileImage) {
  sql += `, profile_image=?`;
  values.push(profileImage);
}

if (verificationDoc) {
  sql += `, verification_doc=?, status='pending'`;
  values.push(verificationDoc);
}

sql += ` WHERE id=?`;
values.push(userId);

  db.query(sql, values, (err) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ message: "Update failed" });
    }

    res.json({ message: "Profile updated successfully" });
  });
});

// ================= ADMIN: GET ALL USERS =================
app.get("/api/admin/users", verifyToken, (req, res) => {

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  db.query(
    "SELECT id, name, email, role, status, is_deleted FROM users",
    (err, result) => {
      if (err) return res.status(500).json([]);
      res.json(result);
    }
  );
});

// ================= ADMIN: DELETE USER =================
app.delete("/api/admin/users/:id", verifyToken, (req, res) => {

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  const userId = req.params.id;

  db.query(
    "UPDATE users SET is_deleted=1 WHERE id=?",
    [userId],
    (err) => {
      if (err) return res.status(500).json({ message: "Delete failed" });
      res.json({ message: "User deleted" });
    }
  );
});


// ================= ADMIN: GET ALL ORDERS =================
app.get("/api/admin/orders", verifyToken, (req, res) => {

  if (req.user.role !== "admin") {
    return res.status(403).json([]);
  }

  const sql = `
   SELECT 
  o.id,
  o.status,
  o.total_amount,
  u.name AS user_name,
  u.email AS user_email
FROM orders o
JOIN users u ON o.user_id = u.id
ORDER BY o.id DESC
  `;

  db.query(sql, (err, orders) => {

    if (err) {
      console.log(err);
      return res.status(500).json([]);
    }

    if (orders.length === 0) {
      return res.json([]);
    }

    const orderIds = orders.map(o => o.id);

    db.query(
      `
      SELECT oi.order_id, oi.quantity, p.name, p.price
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      WHERE oi.order_id IN (?)
      `,
      [orderIds],
      (err, items) => {

        if (err) {
          console.log(err);
          return res.status(500).json([]);
        }

        // attach items to each order
        orders.forEach(o => {
          o.items = items
            .filter(i => i.order_id === o.id)
            .map(i => ({
              name: i.name,
  quantity: i.quantity,
  price: i.price
            }));
        });

        res.json(orders);
      }
    );
  });
});

// ================= ADMIN: UPDATE ORDER =================
app.put("/api/admin/orders/:id", verifyToken, (req, res) => {

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Admin only" });
  }

  const { status } = req.body;

  db.query(
    "UPDATE orders SET status=? WHERE id=?",
    [status, req.params.id],
    (err) => {
      if (err) return res.status(500).json({ message: "Update failed" });
      res.json({ message: "Order updated" });
    }
  );
});
app.get("/api/admin/products", verifyToken, (req, res) => {

  if(req.user.role !== "admin"){
    return res.status(403).json([]);
  }

  db.query("SELECT * FROM products", (err, result)=>{
    if(err) return res.status(500).json([]);
    res.json(result);
  });
});

// ================= ADMIN: APPROVE SELLER =================
app.put("/api/admin/approve-seller/:id", verifyToken, (req, res) => {

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  db.query(
   "UPDATE users SET status='approved' WHERE id=?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ message: "Update failed" });
      res.json({ message: "Seller approved" });
    }
  );
});

// ================= ADMIN: REJECT SELLER =================
app.put("/api/admin/reject-seller/:id", verifyToken, (req, res) => {

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }

  db.query(
    "UPDATE users SET status='rejected' WHERE id=?",
    [req.params.id],
    (err) => {
      if (err) return res.status(500).json({ message: "Update failed" });
      res.json({ message: "Seller rejected" });
    }
  );
});
// ================= SERVER =================
app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});