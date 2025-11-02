(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-INVALID-DONOR u102)
(define-constant ERR-INVALID-CAMPAIGN u103)
(define-constant ERR-ENTRY-NOT-FOUND u104)
(define-constant ERR-LIST-OVERFLOW u105)
(define-constant ERR-INVALID-TIMESTAMP u106)
(define-constant ERR-DUPLICATE-ENTRY u107)
(define-constant ERR-QUERY-LIMIT-EXCEEDED u108)
(define-constant MAX-ENTRIES-PER-DONOR u200)
(define-constant MAX-ENTRIES-PER-CAMPAIGN u200)
(define-constant MAX-QUERY-RESULTS u100)

(define-data-var next-donation-id uint u0)

(define-map donor-donations
  uint
  (list MAX-ENTRIES-PER-DONOR {campaign-id: uint, amount: uint, timestamp: uint, donation-id: uint})
)

(define-map campaign-donations
  uint
  (list MAX-ENTRIES-PER-CAMPAIGN {donor-id: uint, amount: uint, timestamp: uint, donation-id: uint})
)

(define-map donation-details
  uint
  {donor-id: uint, campaign-id: uint, amount: uint, timestamp: uint}
)

(define-read-only (get-donation (donation-id uint))
  (map-get? donation-details donation-id)
)

(define-read-only (get-donor-donations (donor-id uint))
  (default-to (list) (map-get? donor-donations donor-id))
)

(define-read-only (get-campaign-donations (campaign-id uint))
  (default-to (list) (map-get? campaign-donations campaign-id))
)

(define-read-only (get-donor-total (donor-id uint))
  (fold + (map (lambda (entry) (get amount entry)) (get-donor-donations donor-id)) u0)
)

(define-read-only (get-campaign-total (campaign-id uint))
  (fold + (map (lambda (entry) (get amount entry)) (get-campaign-donations campaign-id)) u0)
)

(define-read-only (get-donor-donations-paginated (donor-id uint) (start uint) (limit uint))
  (let ((entries (get-donor-donations donor-id))
        (total (len entries)))
    (if (> limit MAX-QUERY-RESULTS)
        (err ERR-QUERY-LIMIT-EXCEEDED)
        (ok {
          items: (slice entries start (+ start limit)),
          total: total,
          has-more: (> total (+ start limit))
        })))
)

(define-read-only (get-campaign-donations-paginated (campaign-id uint) (start uint) (limit uint))
  (let ((entries (get-campaign-donations campaign-id))
        (total (len entries)))
    (if (> limit MAX-QUERY-RESULTS)
        (err ERR-QUERY-LIMIT-EXCEEDED)
        (ok {
          items: (slice entries start (+ start limit)),
          total: total,
          has-more: (> total (+ start limit))
        })))
)

(define-private (append-donor-entry (donor-id uint) (entry {campaign-id: uint, amount: uint, timestamp: uint, donation-id: uint}))
  (let ((current (get-donor-donations donor-id)))
    (if (>= (len current) MAX-ENTRIES-PER-DONOR)
        (err ERR-LIST-OVERFLOW)
        (begin
          (map-set donor-donations donor-id (unwrap! (as-max-len? (append current entry) u200) (err ERR-LIST-OVERFLOW)))
          (ok true))))
)

(define-private (append-campaign-entry (campaign-id uint) (entry {donor-id: uint, amount: uint, timestamp: uint, donation-id: uint}))
  (let ((current (get-campaign-donations campaign-id)))
    (if (>= (len current) MAX-ENTRIES-PER-CAMPAIGN)
        (err ERR-LIST-OVERFLOW)
        (begin
          (map-set campaign-donations campaign-id (unwrap! (as-max-len? (append current entry) u200) (err ERR-LIST-OVERFLOW)))
          (ok true))))
)

(define-public (log-donation (donor-id uint) (campaign-id uint) (amount uint))
  (let ((timestamp block-height)
        (donation-id (var-get next-donation-id)))
    (asserts! (> donor-id u0) (err ERR-INVALID-DONOR))
    (asserts! (> campaign-id u0) (err ERR-INVALID-CAMPAIGN))
    (asserts! (> amount u0) (err ERR-INVALID-AMOUNT))
    (asserts! (>= timestamp u1) (err ERR-INVALID-TIMESTAMP))
    (try! (append-donor-entry donor-id {campaign-id: campaign-id, amount: amount, timestamp: timestamp, donation-id: donation-id}))
    (try! (append-campaign-entry campaign-id {donor-id: donor-id, amount: amount, timestamp: timestamp, donation-id: donation-id}))
    (map-set donation-details donation-id
      {donor-id: donor-id, campaign-id: campaign-id, amount: amount, timestamp: timestamp})
    (var-set next-donation-id (+ donation-id u1))
    (print {event: "donation-logged", donation-id: donation-id, donor: donor-id, campaign: campaign-id, amount: amount})
    (ok donation-id))
)

(define-read-only (get-latest-donation-id)
  (ok (- (var-get next-donation-id) u1))
)

(define-read-only (get-donation-count-by-donor (donor-id uint))
  (ok (len (get-donor-donations donor-id)))
)

(define-read-only (get-donation-count-by-campaign (campaign-id uint))
  (ok (len (get-campaign-donations campaign-id)))
)

(define-read-only (get-total-donations)
  (ok (var-get next-donation-id))
)