/* attributes: type="module" */
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
        import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
        import { getFirestore, doc, addDoc, onSnapshot, collection, query, serverTimestamp, runTransaction } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
        import { setLogLevel } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

        // Set Firebase logging level (optional, but good for debugging)
        setLogLevel('Debug');

        // Global variables provided by the Canvas environment
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        // IMPORTANT: Because index.html uses a hardcoded config, we must ensure main_app.html can handle
        // the standard Canvas injection, OR, if running outside the Canvas, it should detect a missing user
        // and redirect to the index.html login page.

        // We use the environment provided config (firebaseConfig) for Firestore, but rely on Auth to check status.
        const firebaseConfig = JSON.parse(typeof __firebase_config !== 'undefined' ? __firebase_config : '{}');
        const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
        
        // --- Core Application State & Global References ---
        let userId = null;
        let products = [];
        let ledger = [];
        let notifications = []; // Global store for notifications
        
        const LOW_STOCK_THRESHOLD = 10; 

        let locations = [
            { id: 'wh1', name: 'Main Warehouse' },
            { id: 'wh2', name: 'Production Floor' },
            { id: 'rack_a', name: 'Rack A' },
            { id: 'rack_b', name: 'Rack B' }
        ];
        
        // Initialize Firebase
        const app = initializeApp(firebaseConfig);
        const db = getFirestore(app);
        
// ===== per-user Firestore collections (injected) =====
let productsCollection = null;
let ledgerCollection = null;
let userUid = null;

/**
 * Initialize collection references for the authenticated user.
 * Data will be stored under: /users/{uid}/data/{products,ledger}
 */
function initUserCollections(user) {
    if (!user) return;
    userUid = user.uid;
    const ROOT = `users/${userUid}/data`;
    productsCollection = collection(db, `${ROOT}/products`);
    ledgerCollection = collection(db, `${ROOT}/ledger`);
    console.log("Initialized user collections for:", ROOT);
}
// ===== end injected snippet =====
const auth = getAuth(app);

        // --- Firestore References ---
        // Public data paths (accessible by all authenticated users)
        const PRODUCTS_PATH = `/artifacts/${appId}/public/data/products`;
        const LEDGER_PATH = `/artifacts/${appId}/public/data/ledger`;
        const productsCollection = collection(db, PRODUCTS_PATH);
        const ledgerCollection = collection(db, LEDGER_PATH);

        // --- Utility Functions ---

        /** Shows a user notification in the top right corner */
        function showNotification(type, message, duration = 5000) {
            const id = Date.now();
            const icon = {
                success: '✓',
                error: '✖',
                info: 'i',
                warning: '!'
            }[type];
            
            const newNotification = { id, type, message, icon };
            notifications.unshift(newNotification);
            renderNotifications();

            setTimeout(() => {
                notifications = notifications.filter(n => n.id !== id);
                renderNotifications();
            }, duration);
        }
        
        /** Renders the current notifications list to the DOM */
        function renderNotifications() {
            const center = document.getElementById('notification-center');
            if (!center) return;
            center.innerHTML = '';
            
            notifications.slice(0, 5).forEach(n => { // Limit to 5 visible notifications
                const div = document.createElement('div');
                div.className = `notification ${n.type}`;
                div.innerHTML = `
                    <span class="notification-icon">${n.icon}</span>
                    <span class="notification-message">${n.message}</span>
                `;
                center.appendChild(div);
            });
        }

        /** Formats a number to a currency string */
        function formatNumber(num) {
            return new Intl.NumberFormat().format(num);
        }

        /** Calculates the total stock from the multi-warehouse map */
        function getTotalStock(stockMap) {
            if (!stockMap) return 0;
            return Object.values(stockMap).reduce((sum, qty) => sum + (qty || 0), 0);
        }

        // --- Authentication & Initialization ---

        window.handleLogout = async function() {
            try {
                // Sign out of Firebase Auth
                await signOut(auth);
                // Redirect user back to the login page (index.html)
                window.location.href = 'index.html'; 
            } catch (error) {
                console.error("Logout failed:", error);
                showNotification('error', 'Logout failed. Please try again.');
            }
        }

        // Check if a user is properly logged in (non-anonymous)
        onAuthStateChanged(auth, async (user) => {
            const loadingOverlay = document.getElementById('loading-overlay');
            const appContent = document.getElementById('app-content');
            
            if (user && !user.isAnonymous) {
                // User is signed in via email/password (from index.html redirect)
                userId = user.uid;
                document.getElementById('user-id-display').textContent = `User ID: ${userId}`;
                appContent.style.display = 'flex'; // Show main content
                loadingOverlay.style.display = 'none'; // Hide loading screen
                console.log("Authenticated User:", user.email, "Starting listeners.");
                initUserCollections(user);
                startListeners();
                switchView('dashboard'); // Start on dashboard
            } else if (initialAuthToken) {
                // Handle the initial custom token sign-in from the environment setup
                 try {
                    await signInWithCustomToken(auth, initialAuthToken);
                 } catch (e) {
                    console.error("Custom token sign-in failed:", e);
                    // If token fails, redirect to index.html for standard login
                    window.location.href = 'index.html'; 
                 }
            } else {
                // If no session or token, redirect to login page (index.html)
                console.log("No authenticated user. Redirecting to login.");
                window.location.href = 'index.html';
            }
        });

        // --- Real-time Listeners ---

        function startListeners() {
            // 1. Products Listener (for inventory view and dashboard)
            onSnapshot(productsCollection, (snapshot) => {
                products = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                renderProductsList();
                renderReceiptsForm();
                renderDeliveriesForm();
                renderTransfersForm();
                renderAdjustmentsForm();
                updateDashboardMetrics(); // Update dashboard with new product data
            }, (error) => {
                console.error("Products listener error:", error);
            });

            // 2. Ledger Listener (for transaction log and dashboard)
            onSnapshot(query(ledgerCollection), (snapshot) => {
                ledger = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).sort((a, b) => {
                    const tsA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : 0;
                    const tsB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : 0;
                    return tsB - tsA;
                });
                renderLedger();
                updateDashboardMetrics(); // Update dashboard with new ledger data
                
                // Simulate an external delivery update notification
                if (Math.random() < 0.2) {
                    const lastDelivery = ledger.find(e => e.type === 'Delivery Order');
                    if(lastDelivery) {
                        showNotification('info', `Delivery Order for "${lastDelivery.productName}" updated: Item is now Out for Delivery.`);
                    }
                }
            }, (error) => {
                console.error("Ledger listener error:", error);
            });
        }

        // --- Core Stock Transaction Logic (Using Firestore Transaction for Multi-Warehouse) ---

        /**
         * Generic function to process any stock movement that affects a single product location.
         * @param {string} productId - The ID of the product being affected.
         * @param {number} quantityChange - Positive for increase, negative for decrease.
         * @param {string} type - 'Receipt', 'Delivery', 'Adjustment', 'Transfer-In', 'Transfer-Out', 'Initial Stock'.
         * @param {string} locationId - The specific location where the change occurs.
         * @param {string} notes - Transaction notes.
         */
        async function processStockMovement(productId, quantityChange, type, locationId, notes = '') {
            if (!userId) return showNotification('error', 'User not authenticated.');

            const productRef = doc(db, PRODUCTS_PATH, productId);
            const absoluteChange = Math.abs(quantityChange);

            try {
                await runTransaction(db, async (transaction) => {
                    const productDoc = await transaction.get(productRef);

                    if (!productDoc.exists()) {
                        throw new Error("Product not found. Cannot process movement.");
                    }

                    const productData = productDoc.data();
                    const stockMap = productData.stock || {};
                    const currentQty = stockMap[locationId] || 0;
                    const newQty = currentQty + quantityChange;
                    const totalOldStock = getTotalStock(stockMap);
                    const totalNewStock = totalOldStock + quantityChange; // Global stock change

                    // Check for stock insufficiency at the specific location
                    if (quantityChange < 0 && currentQty < absoluteChange) {
                        throw new Error(`Insufficient stock at ${locations.find(l => l.id === locationId)?.name}. Available: ${currentQty}, Required: ${absoluteChange}.`);
                    }

                    // 1. Update Product Stock Map
                    const updatedStockMap = { ...stockMap, [locationId]: newQty };
                    
                    if (newQty === 0) {
                        delete updatedStockMap[locationId];
                    }

                    transaction.update(productRef, {
                        stock: updatedStockMap
                    });

                    // 2. Log Transaction to Ledger
                    transaction.set(doc(ledgerCollection), {
                        productId: productId,
                        productName: productData.name,
                        locationId: locationId,
                        quantityChange: quantityChange,
                        oldQtyAtLocation: currentQty,
                        newQtyAtLocation: newQty,
                        totalOldStock: totalOldStock,
                        totalNewStock: totalNewStock,
                        type: type,
                        notes: notes,
                        timestamp: serverTimestamp(),
                        userId: userId
                    });
                });

                showNotification('success', `${type} validated successfully! Stock updated by ${quantityChange} at ${locations.find(l => l.id === locationId)?.name}.`);
            } catch (e) {
                console.error("Transaction failed:", e);
                showNotification('error', e.message || `Failed to process ${type}.`);
            }
        }

        // --- Dashboard Metrics Calculation & Update ---

        function updateDashboardMetrics() {
            // METRIC 1: Total Products
            document.getElementById('metric-total-products').textContent = products.length;

            // METRIC 2: Low or Out of Stock Products (Total stock < LOW_STOCK_THRESHOLD)
            const lowStockProducts = products.filter(p => getTotalStock(p.stock) <= LOW_STOCK_THRESHOLD);
            document.getElementById('metric-low-stock').textContent = lowStockProducts.length;
            
            // Low Stock Alert Bar visibility
            const lowStockBar = document.getElementById('low-stock-alert-bar');
            if (lowStockProducts.length > 0) {
                lowStockBar.textContent = `CRITICAL ALERT: ${lowStockProducts.length} product(s) are at or below ${LOW_STOCK_THRESHOLD} units in total stock!`;
                lowStockBar.style.display = 'block';
                // Trigger a notification for critical alert (optional, helps visibility)
                showNotification('warning', lowStockBar.textContent, 10000); 
            } else {
                lowStockBar.style.display = 'none';
            }

            // METRIC 3, 4, 5: Recent Movements (Last 7 days)
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            
            const recentMovements = ledger.filter(entry => 
                entry.timestamp?.toDate && entry.timestamp.toDate() > sevenDaysAgo
            );

            // Filter Ledger for Receipts, Deliveries, and Transfers
            const pendingReceipts = recentMovements.filter(entry => entry.type === 'Receipt').length;
            const pendingDeliveries = recentMovements.filter(entry => entry.type === 'Delivery Order').length;
            const internalTransfers = recentMovements.filter(entry => entry.type.startsWith('Transfer')).length / 2; // Divide by 2 as transfers log 2 entries (In/Out)

            document.getElementById('metric-pending-receipts').textContent = pendingReceipts;
            document.getElementById('metric-pending-deliveries').textContent = pendingDeliveries;
            document.getElementById('metric-internal-transfer').textContent = Math.round(internalTransfers); // Display count of transfer operations

            // Update Ledger Chart (Placeholder for real data)
            // (No chart library is used in Vanilla CSS/JS version, so this is just data calculation)
        }

        // --- 1. Product Management ---
        
        // State for filtering
        let currentFilter = '';
        
        window.handleSearchInput = function(event) {
            currentFilter = event.target.value.toLowerCase().trim();
            renderProductsList();
        }

        window.handleCreateProduct = async function() {
            const name = document.getElementById('new-product-name').value.trim();
            const sku = document.getElementById('new-product-sku').value.trim();
            const category = document.getElementById('new-product-category').value.trim();
            const uom = document.getElementById('new-product-uom').value.trim();
            const initialStock = parseInt(document.getElementById('new-product-stock').value) || 0;
            const initialLocation = document.getElementById('new-product-location').value;

            if (!name || !sku || !category || !uom || !initialLocation) {
                return showNotification('error', 'All fields are required.');
            }

            try {
                const newProduct = {
                    name,
                    sku,
                    category,
                    uom,
                    stock: initialStock > 0 ? { [initialLocation]: initialStock } : {},
                    createdAt: serverTimestamp(),
                    userId: userId
                };
                const docRef = await addDoc(productsCollection, newProduct);
                
                // If initial stock is > 0, log it as an initial receipt for traceability
                if (initialStock > 0) {
                    // Log movement without running full transaction to avoid double stock update (already set in creation)
                    await addDoc(ledgerCollection, {
                        productId: docRef.id,
                        productName: name,
                        locationId: initialLocation,
                        quantityChange: initialStock,
                        oldQtyAtLocation: 0,
                        newQtyAtLocation: initialStock,
                        totalOldStock: 0,
                        totalNewStock: initialStock,
                        type: 'Initial Stock',
                        notes: 'Initial stock entry upon product creation.',
                        timestamp: serverTimestamp(),
                        userId: userId
                    });
                }

                showNotification('success', `Product "${name}" created successfully.`);

                // Clear form
                document.getElementById('create-product-form').reset();
            } catch (e) {
                console.error("Error creating product:", e);
                showNotification('error', `Failed to create product: ${e.message}`);
            }
        }
        
        function renderProductsList() {
            const tableBody = document.getElementById('products-list-body');
            if (!tableBody) return;
            tableBody.innerHTML = '';
            
            // Apply filter logic
            const filteredProducts = products.filter(p => {
                const searchString = `${p.name} ${p.sku} ${p.category}`.toLowerCase();
                return searchString.includes(currentFilter);
            });

            filteredProducts.forEach(p => {
                const totalStock = getTotalStock(p.stock);
                
                // Generate stock breakdown HTML
                const stockBreakdownHTML = locations.map(loc => {
                    const qty = p.stock?.[loc.id] || 0;
                    if (qty > 0) {
                         return `
                            <div style="color: ${qty <= LOW_STOCK_THRESHOLD ? 'var(--color-danger)' : '#374151'};">
                                <strong>${loc.name}:</strong> ${formatNumber(qty)}
                            </div>
                        `;
                    }
                    return '';
                }).join('');


                const row = tableBody.insertRow();
                row.className = '';
                row.innerHTML = `
                    <td>${p.name}</td>
                    <td>${p.sku}</td>
                    <td>${p.category}</td>
                    <td>${p.uom}</td>
                    <td>
                        <div style="font-weight: 700; color: ${totalStock <= LOW_STOCK_THRESHOLD ? 'var(--color-danger)' : 'var(--color-success)'};">${formatNumber(totalStock)}</div>
                    </td>
                    <td>
                        <div class="stock-breakdown">${stockBreakdownHTML || '—'}</div>
                    </td>
                `;
            });
            
            if (filteredProducts.length === 0) {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; padding: 20px;">No products found matching "${currentFilter}".</td></tr>`;
            }
        }
        
        function renderLocationOptions(selectElementId) {
            const select = document.getElementById(selectElementId);
            if (!select) return;
            
            const selectedId = select.value;
            select.innerHTML = '<option value="" disabled selected>-- Select Location --</option>';
            locations.forEach(loc => {
                const option = document.createElement('option');
                option.value = loc.id;
                option.textContent = loc.name;
                if (loc.id === selectedId) option.selected = true;
                select.appendChild(option);
            });
        }
        
        function renderProductOptions(selectElementId, includeStock = false) {
            const select = document.getElementById(selectElementId);
            if (!select) return;

            const selectedId = select.value;
            select.innerHTML = '<option value="" disabled selected>-- Select Product --</option>';
            products.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                
                let text = `${p.name} (${p.sku})`;
                if (includeStock) {
                    const totalStock = getTotalStock(p.stock);
                    text += ` | Global Stock: ${formatNumber(totalStock)}`;
                }
                
                option.textContent = text;
                if (p.id === selectedId) option.selected = true;
                select.appendChild(option);
            });
        }

        // --- 2. Receipts (Incoming Goods) ---

        function renderReceiptsForm() {
            renderProductOptions('receipt-product-id', true);
            renderLocationOptions('receipt-location');
        }

        window.handleReceiptValidation = function() {
            const productId = document.getElementById('receipt-product-id').value;
            const supplier = document.getElementById('receipt-supplier').value.trim();
            const locationId = document.getElementById('receipt-location').value;
            const quantity = parseInt(document.getElementById('receipt-quantity').value);

            if (!productId || !supplier || !quantity || quantity <= 0 || !locationId) {
                return showNotification('error', 'Please complete all fields with a valid quantity (> 0).');
            }

            // Receipt increases stock (positive quantityChange)
            processStockMovement(productId, quantity, 'Receipt', locationId, `Supplier: ${supplier}`);

            // Clear form
            document.getElementById('receipt-form').reset();
        }

        // --- 3. Delivery Orders (Outgoing Goods) ---

        function renderDeliveriesForm() {
            renderProductOptions('delivery-product-id', true);
            renderLocationOptions('delivery-location');
        }

        window.handleDeliveryValidation = function() {
            const productId = document.getElementById('delivery-product-id').value;
            const customerOrder = document.getElementById('delivery-customer-order').value.trim();
            const locationId = document.getElementById('delivery-location').value;
            const quantity = parseInt(document.getElementById('delivery-quantity').value);

            if (!productId || !customerOrder || !quantity || quantity <= 0 || !locationId) {
                return showNotification('error', 'Please complete all fields with a valid quantity (> 0).');
            }

            // Delivery decreases stock (negative quantityChange)
            processStockMovement(productId, -quantity, 'Delivery Order', locationId, `Customer Order: ${customerOrder}`);

            // Clear form
            document.getElementById('delivery-form').reset();
        }

        // --- 4. Internal Transfers ---

        function renderTransfersForm() {
            renderProductOptions('transfer-product-id', true);
            renderLocationOptions('transfer-from-location');
            renderLocationOptions('transfer-to-location');
        }

        window.handleTransferValidation = async function() {
            const productId = document.getElementById('transfer-product-id').value;
            const fromLocation = document.getElementById('transfer-from-location').value;
            const toLocation = document.getElementById('transfer-to-location').value;
            const quantity = parseInt(document.getElementById('transfer-quantity').value);

            if (!productId || !fromLocation || !toLocation || !quantity || quantity <= 0) {
                return showNotification('error', 'Please complete all fields with a valid quantity (> 0).');
            }
            if (fromLocation === toLocation) {
                return showNotification('error', 'Source and Destination locations must be different.');
            }

            const product = products.find(p => p.id === productId);
            if (!product) return showNotification('error', 'Product not found.');
            
            const currentQty = product.stock?.[fromLocation] || 0;
            if (currentQty < quantity) {
                return showNotification('error', `Insufficient stock at ${locations.find(l => l.id === fromLocation)?.name}. Available: ${currentQty}, Required: ${quantity}.`);
            }

            // The transfer involves two separate location movements, but the total product stock is unchanged.
            // We use two transactions to log the movement and update the stock map simultaneously.

            const fromLocationName = locations.find(l => l.id === fromLocation)?.name;
            const toLocationName = locations.find(l => l.id === toLocation)?.name;
            
            try {
                // 1. Transaction: Move OUT of source location (-quantity)
                await processStockMovement(productId, -quantity, 'Transfer-Out', fromLocation, `Moving to: ${toLocationName}`);
                
                // 2. Transaction: Move INTO destination location (+quantity)
                await processStockMovement(productId, quantity, 'Transfer-In', toLocation, `Moved from: ${fromLocationName}`);

                showNotification('success', `Transfer of ${quantity} units from ${fromLocationName} to ${toLocationName} validated.`);
                
                // Clear form
                document.getElementById('transfer-form').reset();
            } catch (e) {
                // processStockMovement already handles errors and notifications inside the transaction logic
                console.error("Transfer transaction chain failed:", e);
                // The error notification is handled by the failed processStockMovement call
            }
        }

        // --- 5. Stock Adjustments ---

        function renderAdjustmentsForm() {
            renderProductOptions('adjustment-product-id', true);
            renderLocationOptions('adjustment-location');
        }

        window.handleAdjustmentValidation = function() {
            const productId = document.getElementById('adjustment-product-id').value;
            const locationId = document.getElementById('adjustment-location').value;
            const countedQuantity = parseInt(document.getElementById('adjustment-counted-quantity').value);
            const reason = document.getElementById('adjustment-reason').value.trim();

            if (!productId || !locationId || !reason || isNaN(countedQuantity) || countedQuantity < 0) {
                return showNotification('error', 'Please complete all fields and enter a valid non-negative counted quantity.');
            }

            const product = products.find(p => p.id === productId);
            if (!product) return showNotification('error', 'Product not found.');

            const recordedStockAtLocation = product.stock?.[locationId] || 0;
            const change = countedQuantity - recordedStockAtLocation;

            if (change === 0) {
                return showNotification('info', 'No adjustment needed. Counted quantity matches recorded stock.');
            }

            // Adjustment changes stock by the difference (counted - recorded)
            processStockMovement(productId, change, 'Stock Adjustment', locationId, `Reason: ${reason} | Set location stock to ${countedQuantity}`);

            // Clear form
            document.getElementById('adjustment-form').reset();
        }

        // --- 6. General Ledger (Transaction Log) ---

        function renderLedger() {
            const tableBody = document.getElementById('ledger-body');
            // Duplicate the ledger for the dashboard summary
            const tableBodyDashboard = document.getElementById('ledger-body-dashboard');

            if (!tableBody || !tableBodyDashboard) return;
            
            // Clear both tables
            tableBody.innerHTML = '';
            tableBodyDashboard.innerHTML = '';


            const locationMap = locations.reduce((map, loc) => { map[loc.id] = loc.name; return map; }, {});

            ledger.slice(0, 50).forEach((l, index) => { // Show last 50 transactions
                const change = l.quantityChange;
                const changeClass = change > 0 ? 'text-success' : (change < 0 ? 'text-danger' : 'text-warning');
                const timestamp = l.timestamp?.toDate ? l.timestamp.toDate().toLocaleString() : 'Processing...';

                // --- Full Ledger Row ---
                const row = tableBody.insertRow();
                row.className = '';

                row.innerHTML = `
                    <td>${timestamp}</td>
                    <td>${l.type}</td>
                    <td>${l.productName}</td>
                    <td>${locationMap[l.locationId] || l.locationId}</td>
                    <td class="${changeClass}" style="text-align: right;">${change > 0 ? '+' : ''}${formatNumber(change)}</td>
                    <td style="text-align: right;">${formatNumber(l.oldQtyAtLocation)}</td>
                    <td style="text-align: right;">${formatNumber(l.totalNewStock)}</td>
                    <td style="font-size: 0.75rem;">${l.notes}</td>
                    <td style="font-size: 0.75rem;">${l.userId.substring(0, 8)}...</td>
                `;
                
                // --- Dashboard Summary Row (Top 10) ---
                if (index < 10) {
                    const dashboardRow = tableBodyDashboard.insertRow();
                     dashboardRow.innerHTML = `
                        <td style="width: 15%;">${timestamp}</td>
                        <td style="width: 15%;">${l.type}</td>
                        <td style="width: 25%;">${l.productName}</td>
                        <td style="width: 20%;">${locationMap[l.locationId] || l.locationId}</td>
                        <td style="width: 10%; text-align: right;" class="${changeClass}">${change > 0 ? '+' : ''}${formatNumber(change)}</td>
                    `;
                }
            });
        }

        // --- View Switching Logic ---

        window.currentView = 'dashboard'; // Set default view to dashboard

        window.switchView = function(viewId) {
            window.currentView = viewId;
            document.querySelectorAll('.app-view').forEach(view => {
                view.style.display = 'none';
            });
            document.getElementById(viewId).style.display = 'block';

            document.querySelectorAll('.nav-item button').forEach(btn => {
                btn.classList.remove('active');
            });

            document.getElementById(`btn-${viewId}`).classList.add('active');
            
            // Re-render forms when switching to ensure options are up-to-date
            if (viewId === 'receipts') renderReceiptsForm();
            if (viewId === 'deliveries') renderDeliveriesForm();
            if (viewId === 'transfers') renderTransfersForm();
            if (viewId === 'adjustments') renderAdjustmentsForm();
            if (viewId === 'products') { 
                renderLocationOptions('new-product-location');
                renderProductsList(); // Rerun list rendering to clear search if present
            }
        }

        // Initial setup on window load
        window.onload = function() {
            // No action needed here, onAuthStateChanged handles initialization and first switchView call
        }

        // Expose functions globally for HTML access
        window.formatNumber = formatNumber;
        window.getTotalStock = getTotalStock;
