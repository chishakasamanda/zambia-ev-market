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

const SECRET = "secretkey";

// ================= IMAGE =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../client/Images");
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
  if (!header) return res.status(403).json({ message: "No token" });

  const token = header.split(" ")[1];

  jwt.verify(token, SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ message: "Invalid token" });

    req.userId = decoded.id;
    req.role = decoded.role;
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
  db.query("SELECT name FROM users WHERE id=?", [req.userId],
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

      if (products.length === 0) return res.json([]);

      const ids = products.map(p => p.id);

      db.query(
        "SELECT * FROM product_images WHERE product_id IN (?)",
        [ids],
        (err, images) => {

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

// ================= SELLER OWN PRODUCTS =================
app.get("/api/my-products", verifyToken, (req, res) => {

  if (req.role !== "seller") {
    return res.status(403).json({ message: "Only sellers allowed" });
  }

  db.query(
    `SELECT * FROM products WHERE seller_id=?`,
    [req.userId],
    (err, products) => {

      if (err) return res.status(500).json({ message: "DB error" });

      res.json(products);
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
      if (result.length === 0) return res.json({});
      res.json(result[0]);
    }
  );
});

// ADD PRODUCT
app.post("/api/products", verifyToken, upload.array("images", 5), (req, res) => {

  if (req.role !== "seller")
    return res.status(403).json({ message: "Only sellers allowed" });

  const { name, price, stock, description } = req.body;

  const mainImage = req.files[0]
    ? "/Images/" + req.files[0].filename
    : "";

  db.query(
    "INSERT INTO products (name,description,price,stock,image_url,seller_id) VALUES (?,?,?,?,?,?)",
    [name, description, price, stock || 0, mainImage, req.userId],
    (err, result) => {

      const productId = result.insertId;

      const imageValues = req.files.map(file => [
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
app.put("/api/products/:id", verifyToken, (req, res) => {

  if (req.role !== "seller")
    return res.status(403).json({ message: "Only sellers allowed" });

  const { name, description, price, stock, image_url } = req.body;

  db.query(
    `UPDATE products 
     SET name=?, description=?, price=?, stock=?, image_url=? 
     WHERE id=? AND seller_id=?`,
    [name, description, price, stock, image_url, req.params.id, req.userId],
    (err) => {
      if (err) return res.status(500).json({ message: "Update failed" });
      res.json({ message: "Product updated" });
    }
  );
});

// ================= DELETE PRODUCT =================
app.delete("/api/products/:id", verifyToken, (req, res) => {

  if (req.role !== "seller")
    return res.status(403).json({ message: "Only sellers allowed" });

  const id = req.params.id;

  console.log("DELETE REQUEST =>", {
    productId: id,
    userId: req.userId,
    role: req.role
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

      if (Number(ownerId) !== Number(req.userId)) {
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
    [req.userId, product_id],
    (err, result) => {

      if (result.length > 0)
        return res.json({ message: "Already in wishlist" });

      db.query(
        "INSERT INTO wishlist (user_id,product_id) VALUES (?,?)",
        [req.userId, product_id],
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
    [req.userId],
    (err, result) => res.json(result)
  );
});

// ================= CART =================

// ADD
app.post("/api/cart/add", verifyToken, (req, res) => {
  const { product_id } = req.body;

  db.query(
    "SELECT * FROM cart WHERE user_id=? AND product_id=?",
    [req.userId, product_id],
    (err, result) => {

      if (result.length > 0) {
        db.query(
          "UPDATE cart SET quantity=quantity+1 WHERE user_id=? AND product_id=?",
          [req.userId, product_id],
          () => res.json({ message: "Updated" })
        );
      } else {
        db.query(
          "INSERT INTO cart VALUES (NULL,?,?,1)",
          [req.userId, product_id],
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
    [req.userId],
    (err, result) => res.json(result)
  );
});
//Checkout/////
app.post("/api/checkout", verifyToken, (req, res) => {

  const { name, phone, address } = req.body;

  if (!name || !phone || !address) {
    return res.status(400).json({ message: "Missing details" });
  }

  // Get cart items
  db.query(
    `SELECT * FROM cart WHERE user_id=?`,
    [req.userId],
    (err, cartItems) => {

      if (cartItems.length === 0) {
        return res.status(400).json({ message: "Cart is empty" });
      }

      // Save order (simple COD system)
      db.query(
        `INSERT INTO orders (user_id, name, phone, address, status)
         VALUES (?,?,?,?,?)`,
        [req.userId, name, phone, address, "COD Pending"],
        (err, orderResult) => {

          const orderId = orderResult.insertId;

          const values = cartItems.map(item => [
            orderId,
            item.product_id,
            item.quantity
          ]);

          db.query(
            `INSERT INTO order_items (order_id, product_id, quantity) VALUES ?`,
            [values],
            () => {

              // clear cart
              db.query(
                "DELETE FROM cart WHERE user_id=?",
                [req.userId],
                () => {
                  res.json({ message: "Order placed successfully (Cash on Delivery)" });
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
      [req.userId, product_id],
      () => res.json({ message: "Removed" })
    );
  } else {
    db.query(
      "UPDATE cart SET quantity=? WHERE user_id=? AND product_id=?",
      [quantity, req.userId, product_id],
      () => res.json({ message: "Updated" })
    );
  }
});

// ================= REVIEWS =================
app.post("/api/reviews", verifyToken, (req, res) => {
  const { product_id, rating, comment } = req.body;

  db.query(
    "SELECT * FROM reviews WHERE user_id=? AND product_id=?",
    [req.userId, product_id],
    (err, result) => {

      if (result.length > 0) {
        db.query(
          "UPDATE reviews SET rating=?, comment=? WHERE user_id=? AND product_id=?",
          [rating, comment, req.userId, product_id],
          () => res.json({ message: "Updated" })
        );
      } else {
        db.query(
          "INSERT INTO reviews (user_id,product_id,rating,comment) VALUES (?,?,?,?)",
          [req.userId, product_id, rating, comment],
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

  db.query(
    "REPLACE INTO recently_viewed (user_id,product_id) VALUES (?,?)",
    [req.userId, product_id],
    () => res.json({ message: "Saved" })
  );
});

app.get("/api/recently-viewed", verifyToken, (req, res) => {
  db.query(
    `SELECT p.* FROM recently_viewed r
     JOIN products p ON r.product_id=p.id
     WHERE r.user_id=?
     ORDER BY r.viewed_at DESC`,
    [req.userId],
    (err, result) => res.json(result)
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

  db.query(sql, [req.userId], (err, result) => {
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

  db.query(sql, [req.userId], (err, result) => {
    res.json(result[0]);
  });
});

// ================= SERVER =================
app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});