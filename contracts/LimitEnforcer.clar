(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-LIMIT u101)
(define-constant ERR-DONOR-NOT-REGISTERED u102)
(define-constant ERR-CAMPAIGN-NOT-REGISTERED u103)
(define-constant ERR-DONATION-EXCEEDS-GLOBAL-LIMIT u104)
(define-constant ERR-DONATION-EXCEEDS-CYCLE-LIMIT u105)
(define-constant ERR-INVALID-CYCLE-INDEX u106)
(define-constant ERR-CYCLE-NOT-CLOSED u107)
(define-constant ERR-INVALID-ADMIN u108)
(define-constant ERR-LIMIT-ALREADY-SET u109)
(define-constant ERR-NO-DONATIONS-IN-CYCLE u110)
(define-constant ERR-ADMIN-NOT-SET u111)

(define-data-var admin (optional principal) none)
(define-data-var global-annual-limit uint u1000000000)
(define-data-var cycle-duration-blocks uint u525600)
(define-data-var current-cycle-index uint u0)

(define-map donor-cycles
  { donor-id: uint, cycle-index: uint }
  { total-donated: uint }
)

(define-map campaign-cycles
  { campaign-id: uint, cycle-index: uint }
  { total-received: uint }
)

(define-map donor-registry principal uint)
(define-map campaign-registry principal uint)

(define-read-only (get-admin)
  (var-get admin)
)

(define-read-only (get-global-annual-limit)
  (ok (var-get global-annual-limit))
)

(define-read-only (get-cycle-duration)
  (ok (var-get cycle-duration-blocks))
)

(define-read-only (get-current-cycle-index)
  (ok (var-get current-cycle-index))
)

(define-read-only (get-donor-total-in-cycle (donor-id uint) (cycle-index uint))
  (map-get? donor-cycles { donor-id: donor-id, cycle-index: cycle-index })
)

(define-read-only (get-campaign-total-in-cycle (campaign-id uint) (cycle-index uint))
  (map-get? campaign-cycles { campaign-id: campaign-id, cycle-index: cycle-index })
)

(define-read-only (is-donor-registered (donor principal))
  (is-some (map-get? donor-registry donor))
)

(define-read-only (is-campaign-registered (campaign principal))
  (is-some (map-get? campaign-registry campaign))
)

(define-private (assert-admin)
  (let ((sender tx-sender))
    (asserts! (is-some (var-get admin)) (err ERR-ADMIN-NOT-SET))
    (asserts! (is-eq (unwrap! (var-get admin) (err ERR-ADMIN-NOT-SET)) sender) (err ERR-UNAUTHORIZED))
    (ok true))
)

(define-private (get-or-create-donor-cycle (donor-id uint) (cycle-index uint))
  (match (map-get? donor-cycles { donor-id: donor-id, cycle-index: cycle-index })
    existing existing
    (begin
      (map-set donor-cycles
        { donor-id: donor-id, cycle-index: cycle-index }
        { total-donated: u0 }
      )
      { total-donated: u0 }
    )
  )
)

(define-private (get-or-create-campaign-cycle (campaign-id uint) (cycle-index uint))
  (match (map-get? campaign-cycles { campaign-id: campaign-id, cycle-index: cycle-index })
    existing existing
    (begin
      (map-set campaign-cycles
        { campaign-id: campaign-id, cycle-index: cycle-index }
        { total-received: u0 }
      )
      { total-received: u0 }
    )
  )
)

(define-private (advance-cycle-if-needed)
  (let (
    (current-block block-height)
    (cycle-start (* (var-get current-cycle-index) (var-get cycle-duration-blocks)))
  )
    (if (>= current-block (+ cycle-start (var-get cycle-duration-blocks)))
      (begin
        (var-set current-cycle-index (+ (var-get current-cycle-index) u1))
        (ok true)
      )
      (ok false)
    )
  )
)

(define-public (set-admin (new-admin principal))
  (begin
    (asserts! (is-none (var-get admin)) (err ERR-LIMIT-ALREADY-SET))
    (var-set admin (some new-admin))
    (ok true))
)

(define-public (update-admin (new-admin principal))
  (begin
    (try! (assert-admin))
    (var-set admin (some new-admin))
    (ok true))
)

(define-public (set-global-annual-limit (new-limit uint))
  (begin
    (try! (assert-admin))
    (asserts! (> new-limit u0) (err ERR-INVALID-LIMIT))
    (var-set global-annual-limit new-limit)
    (ok true))
)

(define-public (set-cycle-duration (blocks uint))
  (begin
    (try! (assert-admin))
    (asserts! (> blocks u0) (err ERR-INVALID-LIMIT))
    (var-set cycle-duration-blocks blocks)
    (ok true))
)

(define-public (register-donor (donor principal))
  (let ((donor-id (default-to u0 (map-get? donor-registry donor))))
    (asserts! (is-eq donor-id u0) (err ERR-DONOR-NOT-REGISTERED))
    (map-set donor-registry donor (+ (len (map-keys donor-registry)) u1))
    (ok (+ (len (map-keys donor-registry)) u1))
  )
)

(define-public (register-campaign (campaign principal))
  (let ((campaign-id (default-to u0 (map-get? campaign-registry campaign))))
    (asserts! (is-eq campaign-id u0) (err ERR-CAMPAIGN-NOT-REGISTERED))
    (map-set campaign-registry campaign (+ (len (map-keys campaign-registry)) u1))
    (ok (+ (len (map-keys campaign-registry)) u1))
  )
)

(define-public (check-donation (donor-principal principal) (campaign-principal principal) (amount uint))
  (let (
    (donor-id (unwrap! (map-get? donor-registry donor-principal) (err ERR-DONOR-NOT-REGISTERED)))
    (campaign-id (unwrap! (map-get? campaign-registry campaign-principal) (err ERR-CAMPAIGN-NOT-REGISTERED)))
    (cycle-index (var-get current-cycle-index))
    (donor-cycle (get-or-create-donor-cycle donor-id cycle-index))
    (current-total (get total-donated donor-cycle))
  )
    (try! (advance-cycle-if-needed))
    (asserts! (<= (+ current-total amount) (var-get global-annual-limit)) (err ERR-DONATION-EXCEEDS-GLOBAL-LIMIT))
    (map-set donor-cycles
      { donor-id: donor-id, cycle-index: cycle-index }
      { total-donated: (+ current-total amount) }
    )
    (let ((campaign-cycle (get-or-create-campaign-cycle campaign-id cycle-index)))
      (map-set campaign-cycles
        { campaign-id: campaign-id, cycle-index: cycle-index }
        { total-received: (+ (get total-received campaign-cycle) amount) }
      )
    )
    (ok true))
)

(define-public (force-advance-cycle)
  (begin
    (try! (assert-admin))
    (var-set current-cycle-index (+ (var-get current-cycle-index) u1))
    (ok (var-get current-cycle-index))
  )
)

(define-read-only (get-donor-id (donor principal))
  (map-get? donor-registry donor)
)

(define-read-only (get-campaign-id (campaign principal))
  (map-get? campaign-registry campaign)
)

(define-read-only (get-total-donated-by-donor-in-cycle (donor-id uint) (cycle-index uint))
  (match (map-get? donor-cycles { donor-id: donor-id, cycle-index: cycle-index })
    entry (ok (get total-donated entry))
    (ok u0)
  )
)

(define-read-only (get-total-received-by-campaign-in-cycle (campaign-id uint) (cycle-index uint))
  (match (map-get? campaign-cycles { campaign-id: campaign-id, cycle-index: cycle-index })
    entry (ok (get total-received entry))
    (ok u0)
  )
)

(define-public (close-cycle-and-get-stats (cycle-index uint))
  (let (
    (current-index (var-get current-cycle-index))
    (cycle-start (* cycle-index (var-get cycle-duration-blocks)))
    (cycle-end (+ cycle-start (var-get cycle-duration-blocks)))
  )
    (asserts! (< cycle-index current-index) (err ERR-CYCLE-NOT-CLOSED))
    (asserts! (<= cycle-end block-height) (err ERR-CYCLE-NOT-CLOSED))
    (ok {
      cycle-index: cycle-index,
      total-donors: (len (filter (lambda (k) (is-eq (get cycle-index k) cycle-index)) (map-keys donor-cycles))),
      total-campaigns: (len (filter (lambda (k) (is-eq (get cycle-index k) cycle-index)) (map-keys campaign-cycles)))
    })
  )
)