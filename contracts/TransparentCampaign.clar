(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-DONOR u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-CAMPAIGN-EXPIRED u103)
(define-constant ERR-CAMPAIGN-NOT-FOUND u104)
(define-constant ERR-LIMIT-EXCEEDED u105)
(define-constant ERR-INSUFFICIENT-BALANCE u106)
(define-constant ERR-INVALID-STATUS u107)
(define-constant ERR-INVALID-DURATION u108)
(define-constant ERR-INVALID-RECIPIENT u109)
(define-constant ERR-ALREADY-INITIALIZED u110)
(define-constant ERR-INVALID-MAX-DONATION u111)
(define-constant ERR-INVALID-TOTAL-LIMIT u112)
(define-constant ERR-INVALID-TIMESTAMP u113)

(define-trait limit-enforcer-trait
  ((check-donation (uint uint uint) (response bool uint))))

(define-trait tracker-trait
  ((log-donation (uint uint uint) (response bool uint))))

(define-data-var campaign-id uint u0)
(define-data-var owner principal tx-sender)
(define-data-var max-per-donation uint u0)
(define-data-var total-limit uint u0)
(define-data-var current-total uint u0)
(define-data-var start-time uint u0)
(define-data-var duration uint u0)
(define-data-var status bool false)
(define-data-var limit-enforcer (optional principal) none)
(define-data-var tracker (optional principal) none)

(define-map donor-contributions uint uint)
(define-map withdrawals uint {recipient: principal, amount: uint, timestamp: uint})

(define-public (initialize 
  (id uint) 
  (campaign-owner principal) 
  (max-donation uint) 
  (total-cap uint) 
  (campaign-duration uint)
  (enforcer-contract principal)
  (tracker-contract principal))
  (begin
    (asserts! (not (var-get status)) (err ERR-ALREADY-INITIALIZED))
    (asserts! (> max-donation u0) (err ERR-INVALID-MAX-DONATION))
    (asserts! (> total-cap u0) (err ERR-INVALID-TOTAL-LIMIT))
    (asserts! (> campaign-duration u0) (err ERR-INVALID-DURATION))
    (asserts! (not (is-eq campaign-owner (as-contract tx-sender))) (err ERR-INVALID-RECIPIENT))
    (var-set campaign-id id)
    (var-set owner campaign-owner)
    (var-set max-per-donation max-donation)
    (var-set total-limit total-cap)
    (var-set duration campaign-duration)
    (var-set start-time block-height)
    (var-set limit-enforcer (some enforcer-contract))
    (var-set tracker (some tracker-contract))
    (var-set status true)
    (ok true)))

(define-public (donate (donor-id uint) (amount uint))
  (let ((current (default-to u0 (map-get? donor-contributions donor-id))))
    (asserts! (var-get status) (err ERR-INVALID-STATUS))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (<= (+ block-height (var-get duration)) block-height) (err ERR-CAMPAIGN-EXPIRED))
    (asserts! (<= amount (var-get max-per-donation)) (err ERR-INVALID-AMOUNT))
    (asserts! (<= (+ (var-get current-total) amount) (var-get total-limit)) (err ERR-LIMIT-EXCEEDED))
    (let ((enforcer (unwrap! (var-get limit-enforcer) (err ERR-NOT-AUTHORIZED))))
      (try! (contract-call? enforcer check-donation donor-id (var-get campaign-id) amount)))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender)))
    (map-set donor-contributions donor-id (+ current amount))
    (var-set current-total (+ (var-get current-total) amount))
    (let ((tracker-contract (unwrap! (var-get tracker) (err ERR-NOT-AUTHORIZED))))
      (try! (contract-call? tracker-contract log-donation donor-id (var-get campaign-id) amount)))
    (ok true)))

(define-public (withdraw (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-AUTHORIZED))
    (asserts! (var-get status) (err ERR-INVALID-STATUS))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (<= amount (stx-get-balance (as-contract tx-sender))) (err ERR-INSUFFICIENT-BALANCE))
    (asserts! (not (is-eq recipient (as-contract tx-sender))) (err ERR-INVALID-RECIPIENT))
    (let ((enforcer (unwrap! (var-get limit-enforcer) (err ERR-NOT-AUTHORIZED))))
      (try! (contract-call? enforcer check-donation u0 (var-get campaign-id) u0)))
    (try! (as-contract (stx-transfer? amount tx-sender recipient)))
    (map-set withdrawals (var-get current-total) {recipient: recipient, amount: amount, timestamp: block-height})
    (ok true)))

(define-public (set-status (new-status bool))
  (begin
    (asserts! (is-eq tx-sender (var-get owner)) (err ERR-NOT-AUTHORIZED))
    (var-set status new-status)
    (ok true)))

(define-read-only (get-balance)
  (ok (stx-get-balance (as-contract tx-sender))))

(define-read-only (get-total-donations)
  (ok (var-get current-total)))

(define-read-only (get-campaign-details)
  (ok {
    id: (var-get campaign-id),
    owner: (var-get owner),
    max-per-donation: (var-get max-per-donation),
    total-limit: (var-get total-limit),
    current-total: (var-get current-total),
    start-time: (var-get start-time),
    duration: (var-get duration),
    status: (var-get status)
  }))

(define-read-only (get-donor-contribution (donor-id uint))
  (ok (default-to u0 (map-get? donor-contributions donor-id))))

(define-read-only (get-withdrawal (withdrawal-id uint))
  (ok (map-get? withdrawals withdrawal-id)))

(define-read-only (is-campaign-active)
  (ok (and (var-get status) (<= (+ (var-get start-time) (var-get duration)) block-height))))