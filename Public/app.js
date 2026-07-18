// Mobile Menu Selector & Logic
if (window.location.hostname === 'mayonrentacar.com.ph') {
    const canonicalUrl = `https://www.mayonrentacar.com.ph${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(canonicalUrl);
}

const menu = document.querySelector('#mobile-menu');
const menuLinks = document.querySelector('.navbar__menu');
const servicesDropdown = document.querySelector('.navbar__item--dropdown');
const servicesDropdownTrigger = document.querySelector('.navbar__links--dropdown');
const servicesDropdownMenu = servicesDropdown ? servicesDropdown.querySelector('.dropdown__menu') : null;

function isMobileNavViewport() {
    return window.matchMedia('(max-width: 960px)').matches;
}

function syncMenuState(isOpen) {
    if (!menu || !menuLinks) return;

    menu.classList.toggle('is-active', isOpen);
    menuLinks.classList.toggle('active', isOpen);

    if (isMobileNavViewport()) {
        menuLinks.style.left = isOpen ? '0' : '-100%';
        menuLinks.style.opacity = isOpen ? '1' : '0';
        menuLinks.style.zIndex = isOpen ? '99' : '';
    } else {
        menuLinks.style.removeProperty('left');
        menuLinks.style.removeProperty('opacity');
        menuLinks.style.removeProperty('z-index');
    }

    if (!isOpen) {
        syncServicesDropdownState(false);
    }
}

function syncServicesDropdownState(isOpen) {
    if (!servicesDropdown || !servicesDropdownMenu) return;

    servicesDropdown.classList.toggle('is-open', isOpen);

    if (isMobileNavViewport()) {
        servicesDropdownMenu.style.maxHeight = isOpen ? '760px' : '0px';
        servicesDropdownMenu.style.padding = isOpen ? '12px 14px' : '0';
        servicesDropdownMenu.style.opacity = '1';
        servicesDropdownMenu.style.visibility = 'visible';
        servicesDropdownMenu.style.pointerEvents = 'auto';
        servicesDropdownMenu.style.transform = 'none';
    } else {
        servicesDropdownMenu.style.maxHeight = '';
        servicesDropdownMenu.style.padding = '';
        servicesDropdownMenu.style.opacity = isOpen ? '1' : '0';
        servicesDropdownMenu.style.visibility = isOpen ? 'visible' : 'hidden';
        servicesDropdownMenu.style.pointerEvents = isOpen ? 'auto' : 'none';
        servicesDropdownMenu.style.transform = isOpen ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(8px)';
    }
}

if (menu) {
    menu.addEventListener('click', function(e) {
        e.preventDefault();
        syncMenuState(!menuLinks.classList.contains('active'));
    });
}

if (servicesDropdown && servicesDropdownTrigger) {
    servicesDropdownTrigger.addEventListener('click', (e) => {
        e.preventDefault();
        syncServicesDropdownState(!servicesDropdown.classList.contains('is-open'));
    });

    document.addEventListener('click', (e) => {
        if (!servicesDropdown.contains(e.target)) {
            syncServicesDropdownState(false);
        }
    });

    window.addEventListener('resize', () => {
        syncServicesDropdownState(false);
        if (!isMobileNavViewport()) {
            syncMenuState(false);
        }
    });

    servicesDropdownMenu?.querySelectorAll('.dropdown__link').forEach((link) => {
        link.addEventListener('click', () => {
            syncServicesDropdownState(false);
            if (isMobileNavViewport()) {
                syncMenuState(false);
            }
        });
    });
}

// Multi-step Booking Form Wizard Engine
document.addEventListener('DOMContentLoaded', () => {
    const DEBUG = false;
    const BOOKING_API_ENDPOINT = '/api/bookings';

    const steps = document.querySelectorAll('.form-step');
    const stepIndicators = document.querySelectorAll('.step');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const submitBtn = document.querySelector('.submit-booking-btn');
    const bookingForm = document.querySelector('.booking-form');
    
    let currentStep = 0;

    // Conditional elements
    const typeSelfDrive = document.getElementById('type-self-drive');
    const typeWithDriver = document.getElementById('type-with-driver');
    const driverOptions = document.getElementById('options-with-driver');
    const driverSelect = document.getElementById('driver-service');

    // Conditional Fields based on Choice
    const selfDriveFields = document.querySelectorAll('.self-drive-only');
    const withDriverFields = document.querySelectorAll('.with-driver-only');

    function updateFormSteps() {
        // Show/Hide steps layout
        steps.forEach((step, index) => {
            if (index === currentStep) {
                step.classList.add('form-step--active');
                step.style.display = 'flex'; // Siguradong litaw sa mobile flex layout
            } else {
                step.classList.remove('form-step--active');
                step.style.display = 'none';
            }
        });

        // Update step indicator classes
        stepIndicators.forEach((indicator, index) => {
            if (index <= currentStep) {
                indicator.classList.add('step--active');
            } else {
                indicator.classList.remove('step--active');
            }
        });

        // Navigation button conditional renders
        if (currentStep === 0) {
            if (prevBtn) {
                prevBtn.disabled = true;
                prevBtn.style.display = 'none';
            }
        } else {
            if (prevBtn) {
                prevBtn.disabled = false;
                prevBtn.style.display = 'block';
            }
        }

        if (currentStep === steps.length - 1) {
            if (nextBtn) nextBtn.style.display = 'none';
            if (submitBtn) submitBtn.style.display = 'block';
        } else {
            if (nextBtn) nextBtn.style.display = 'block';
            if (submitBtn) submitBtn.style.display = 'none';
        }
        
        // Auto-scroll pabalik sa taas ng form para sa mobile view kapag nag-next
        const bookingSection = document.querySelector('.booking-section');
        if (bookingSection) {
            bookingSection.scrollIntoView({ behavior: 'smooth' });
        }
    }

    // Input validations engine per step
    function validateStepInputs() {
        const activeStepFields = steps[currentStep].querySelectorAll('input[required], select[required], textarea[required]');
        let isValid = true;

        activeStepFields.forEach(field => {
            // Check if element is part of hidden parent logic
            const isSelfDriveHidden = field.closest('.self-drive-only') && typeWithDriver && typeWithDriver.checked;
            const isWithDriverHidden = field.closest('.with-driver-only') && typeSelfDrive && typeSelfDrive.checked;
            const isServiceSelectHidden = field.id === 'driver-service' && typeSelfDrive && typeSelfDrive.checked;

            if (isSelfDriveHidden || isWithDriverHidden || isServiceSelectHidden) {
                return; // Skip hidden logic fields
            }

            if (field.type === 'radio') {
                const checkedRadio = steps[currentStep].querySelector(`input[name="${field.name}"]:checked`);
                if (!checkedRadio) {
                    isValid = false;
                }
            } else if (!field.value.trim()) {
                isValid = false;
                field.style.borderColor = '#ef4444'; // Pula kapag kulang
            } else {
                field.style.borderColor = '#cbd5e1';
            }
        });

        return isValid;
    }

    function attachFieldRecoveryListeners() {
        const formFields = bookingForm.querySelectorAll('input[required], select[required], textarea[required]');

        formFields.forEach(field => {
            field.addEventListener('input', () => {
                if (field.value.trim()) {
                    field.style.borderColor = '#cbd5e1';
                }
            });

            field.addEventListener('change', () => {
                if (field.value.trim()) {
                    field.style.borderColor = '#cbd5e1';
                }
            });
        });
    }

    function setSubmitLoading(isLoading) {
        if (!submitBtn) return;
        submitBtn.disabled = isLoading;
        submitBtn.textContent = isLoading ? 'Sending...' : 'Submit Booking Request';
    }

    // Step 2 Radio logic updates
    function handleRentalTypeChange() {
        if (!typeWithDriver || !typeSelfDrive) return;

        if (typeWithDriver.checked) {
            if (driverOptions) driverOptions.style.display = 'block';
            if (driverSelect) driverSelect.setAttribute('required', 'required');
            
            selfDriveFields.forEach(el => el.style.display = 'none');
            withDriverFields.forEach(el => el.style.display = 'flex');
            
            const returnDate = document.getElementById('return_date');
            const returnTime = document.getElementById('return_time');
            const returnAddress = document.getElementById('return_address');
            const passengers = document.getElementById('passengers');
            const nameLabel = document.getElementById('name-label');

            if (returnDate) returnDate.removeAttribute('required');
            if (returnTime) returnTime.removeAttribute('required');
            if (returnAddress) returnAddress.removeAttribute('required');
            if (passengers) passengers.setAttribute('required', 'required');
            if (nameLabel) nameLabel.innerText = "Name *";
        } else if (typeSelfDrive.checked) {
            if (driverOptions) driverOptions.style.display = 'none';
            if (driverSelect) driverSelect.removeAttribute('required');

            selfDriveFields.forEach(el => el.style.display = 'flex');
            withDriverFields.forEach(el => el.style.display = 'none');

            const returnDate = document.getElementById('return_date');
            const returnTime = document.getElementById('return_time');
            const returnAddress = document.getElementById('return_address');
            const passengers = document.getElementById('passengers');
            const nameLabel = document.getElementById('name-label');

            if (returnDate) returnDate.setAttribute('required', 'required');
            if (returnTime) returnTime.setAttribute('required', 'required');
            if (returnAddress) returnAddress.setAttribute('required', 'required');
            if (passengers) passengers.removeAttribute('required');
            if (nameLabel) nameLabel.innerText = "Name / Driver's Name *";
        }
    }

    if (typeSelfDrive && typeWithDriver) {
        typeSelfDrive.addEventListener('change', handleRentalTypeChange);
        typeWithDriver.addEventListener('change', handleRentalTypeChange);
    }

    // Dynamic min attributes for date inputs: prevent selecting past dates
    const pickupDateInput = document.getElementsByName('pickup_date')[0];
    const returnDateInput = document.getElementById('return_date');

    if (pickupDateInput) {
        const ngayon = new Date();
        const taon = ngayon.getFullYear();
        const buwan = String(ngayon.getMonth() + 1).padStart(2, '0');
        const araw = String(ngayon.getDate()).padStart(2, '0');
        const formatNaPetsa = `${taon}-${buwan}-${araw}`;

        // Set pickup min to today
        pickupDateInput.min = formatNaPetsa;

        // If there's already a pickup value, ensure return min follows it
        if (returnDateInput && pickupDateInput.value) {
            returnDateInput.min = pickupDateInput.value;
        }

        // When pickup changes, update return.min and clear invalid return date
        pickupDateInput.addEventListener('change', function() {
            if (returnDateInput) {
                returnDateInput.min = this.value;
                if (returnDateInput.value && returnDateInput.value < this.value) {
                    returnDateInput.value = '';
                }
            }
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (validateStepInputs()) {
                if (currentStep < steps.length - 1) {
                    currentStep++;
                    updateFormSteps();
                }
            } else {
                alert('Mangyaring punan ang lahat ng kinakailangang field (*) bago magpatuloy.');
            }
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentStep > 0) {
                currentStep--;
                updateFormSteps();
            }
        });
    }

    // ==========================================
    // PINAGSAMANG SUBMIT AT BACKEND CONNECTION LOGIC
    // ==========================================
    if (bookingForm) {
        attachFieldRecoveryListeners();

        bookingForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            if (!validateStepInputs()) {
                alert('Pakikumpleto ang mga kulang na impormasyon.');
                return;
            }

            // Client-side date validations: pickup must be >= today; return (for self-drive) must be >= pickup
            const pickupField = document.getElementsByName('pickup_date')[0];
            const returnField = document.getElementById('return_date');
            const selectedRentalTypeRadio = document.querySelector('input[name="rental_type"]:checked');
            const rentalTypeValue = selectedRentalTypeRadio ? selectedRentalTypeRadio.value : '';

            if (pickupField) {
                const pickupVal = pickupField.value;
                const today = new Date();
                today.setHours(0,0,0,0);
                const pickupDateObj = pickupVal ? new Date(pickupVal) : null;

                if (!pickupVal || !pickupDateObj || isNaN(pickupDateObj.getTime())) {
                    alert('Pakilagay ang tamang Pick-up date.');
                    pickupField.style.borderColor = '#ef4444';
                    return;
                }
                pickupDateObj.setHours(0,0,0,0);
                if (pickupDateObj < today) {
                    alert('Pick-up date must be today or a future date.');
                    pickupField.style.borderColor = '#ef4444';
                    return;
                }

                if (rentalTypeValue === 'self-drive' && returnField) {
                    const returnVal = returnField.value;
                    const returnDateObj = returnVal ? new Date(returnVal) : null;
                    if (!returnVal || !returnDateObj || isNaN(returnDateObj.getTime())) {
                        alert('Para sa Self-Drive, pakilagay ang tamang Return date.');
                        returnField.style.borderColor = '#ef4444';
                        return;
                    }
                    returnDateObj.setHours(0,0,0,0);
                    if (returnDateObj < pickupDateObj) {
                        alert('Return date cannot be earlier than Pick-up date.');
                        returnField.style.borderColor = '#ef4444';
                        return;
                    }
                }
            }

            // Execute reCAPTCHA v3 before submitting
            let recaptchaToken = '';
            try {
                const RECAPTCHA_SITE_KEY = 'YOUR_RECAPTCHA_SITE_KEY';
                if (typeof grecaptcha !== 'undefined' && RECAPTCHA_SITE_KEY && RECAPTCHA_SITE_KEY !== 'YOUR_RECAPTCHA_SITE_KEY') {
                    recaptchaToken = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: 'submit_booking' });
                    document.getElementById('recaptchaToken').value = recaptchaToken;
                } else {
                    if (DEBUG) console.log('reCAPTCHA skipped (no valid site key or grecaptcha not loaded)');
                }
            } catch (err) {
                console.warn('reCAPTCHA execution failed:', err);
            }

            const formData = new FormData(this);
            const bookingData = Object.fromEntries(formData.entries());
            const selectedRentalType = bookingData.rental_type || '';

            bookingData.rentalType = selectedRentalType;

            if (selectedRentalType === 'with-driver') {
                bookingData.serviceOption = bookingData.driver_service || '';
            } else {
                bookingData.serviceOption = '—';
            }

            // Normalize vehicle field name to backend expected `vehicleType` (frontend uses `vehicle_type`)
            if (!bookingData.vehicleType) {
                if (bookingData.vehicle_type) bookingData.vehicleType = bookingData.vehicle_type;
                else if (bookingData.vehicle) bookingData.vehicleType = bookingData.vehicle;
            }

            try {
                setSubmitLoading(true);

                // Use same-origin API path so Vercel rewrite handles forwarding to backend.
                const response = await fetch(BOOKING_API_ENDPOINT, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(bookingData)
                });

                let result = {};
                try {
                    result = await response.json();
                } catch (jsonError) {
                    result = {};
                }

                if (response.ok && result.success) {
                    alert(`Thank you! Your booking request ${result.booking.ref} has been submitted.`);
                    this.reset();
                    window.location.reload(); // I-refresh ang layout para bumalik sa Step 1
                } else {
                    const serverMessage = result.error || `HTTP ${response.status}`;
                    alert('May error sa server: ' + serverMessage);
                }
            } catch (error) {
                console.error('Error submitting to backend:', error);
                alert('Hindi makakonekta sa server. Pakisubukan ulit maya-maya o i-check ang deployed API service.');
            } finally {
                setSubmitLoading(false);
            }
        });
    }

    // Initialize layout setup state
    updateFormSteps();
});

// ==========================================
// FLEET VEHICLE FILTER ENGINE (SEDAN, MPV, EV)
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    const contactForm = document.querySelector('.contact-form');
    const contactSubmitBtn = document.querySelector('.contact-submit-btn');
    const contactStatus = document.getElementById('contact-form-status');
    let cooldownIntervalId = null;
    let cooldownUntil = 0;

    if (!contactForm) return;

    function setContactSubmitLoading(isLoading, label) {
        if (!contactSubmitBtn) return;
        contactSubmitBtn.disabled = isLoading;
        contactSubmitBtn.textContent = label || (isLoading ? 'Sending...' : 'Submit Inquiry');
    }

    function showContactStatus(message, type) {
        if (!contactStatus) return;
        contactStatus.textContent = message;
        contactStatus.className = `contact-form-status is-${type}`;
    }

    function clearContactStatus() {
        if (!contactStatus) return;
        contactStatus.textContent = '';
        contactStatus.className = 'contact-form-status';
    }

    function clearFieldErrors() {
        const fields = contactForm.querySelectorAll('input, textarea');
        fields.forEach((field) => {
            field.classList.remove('input-error');
        });

        const errorMessages = contactForm.querySelectorAll('.field-error');
        errorMessages.forEach((msg) => msg.remove());
    }

    function setFieldError(field, message) {
        if (!field) return;
        field.classList.add('input-error');

        const group = field.closest('.partner-input-group');
        if (!group) return;

        const existingError = group.querySelector('.field-error');
        if (existingError) {
            existingError.textContent = message;
            return;
        }

        const errorEl = document.createElement('small');
        errorEl.className = 'field-error';
        errorEl.textContent = message;
        group.appendChild(errorEl);
    }

    function validateContactForm(formValues) {
        clearFieldErrors();

        const nameField = contactForm.querySelector('[name="customer_name"]');
        const emailField = contactForm.querySelector('[name="customer_email"]');
        const contactField = contactForm.querySelector('[name="customer_contact"]');
        const messageField = contactForm.querySelector('[name="customer_message"]');

        let isValid = true;

        const name = (formValues.customer_name || '').trim();
        const email = (formValues.customer_email || '').trim();
        const contact = (formValues.customer_contact || '').trim();
        const message = (formValues.customer_message || '').trim();

        if (!name || name.length < 2) {
            setFieldError(nameField, 'Please enter your full name.');
            isValid = false;
        }

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setFieldError(emailField, 'Please enter a valid email address.');
            isValid = false;
        }

        const normalizedContact = contact.replace(/[^\d+]/g, '');
        if (!contact || !/^(\+?63\d{10}|0\d{10})$/.test(normalizedContact)) {
            setFieldError(contactField, 'Use international format: +63.');
            isValid = false;
        }

        if (!message || message.length < 5) {
            setFieldError(messageField, 'Please enter at least 5 characters.');
            isValid = false;
        }

        return isValid;
    }

    function startSubmitCooldown(seconds) {
        if (!contactSubmitBtn) return;

        cooldownUntil = Date.now() + (seconds * 1000);
        if (cooldownIntervalId) clearInterval(cooldownIntervalId);

        setContactSubmitLoading(true, `Sent. Wait ${seconds}s`);

        cooldownIntervalId = setInterval(() => {
            const remaining = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
            if (remaining <= 0) {
                clearInterval(cooldownIntervalId);
                cooldownIntervalId = null;
                setContactSubmitLoading(false, 'Submit Inquiry');
                return;
            }
            setContactSubmitLoading(true, `Sent. Wait ${remaining}s`);
        }, 250);
    }

    contactForm.addEventListener('submit', async function(e) {
        e.preventDefault();

        if (Date.now() < cooldownUntil) {
            const remaining = Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000));
            showContactStatus(`Please wait ${remaining}s before submitting again.`, 'error');
            return;
        }

        const formData = new FormData(this);
        const contactData = Object.fromEntries(formData.entries());

        clearContactStatus();
        if (!validateContactForm(contactData)) {
            showContactStatus('Please fix the highlighted fields and try again.', 'error');
            return;
        }

        const payload = {
            ...contactData,
            partner_name: contactData.partner_name || contactData.customer_name || '',
            partner_email: contactData.partner_email || contactData.customer_email || '',
            partner_contact: contactData.partner_contact || contactData.customer_contact || '',
            partner_message: contactData.partner_message || contactData.customer_message || '',
            name: contactData.customer_name || contactData.partner_name || '',
            email: contactData.customer_email || contactData.partner_email || '',
            contact: contactData.customer_contact || contactData.partner_contact || '',
            message: contactData.customer_message || contactData.partner_message || ''
        };

        try {
            setContactSubmitLoading(true);

            const response = await fetch('/api/contact', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const rawBody = await response.text();
            let result = {};
            try {
                result = rawBody ? JSON.parse(rawBody) : {};
            } catch {
                result = { raw: rawBody };
            }

            if (response.ok && result.success) {
                showContactStatus(result.message || 'Inquiry submitted successfully.', 'success');
                this.reset();
                clearFieldErrors();
                startSubmitCooldown(8);
            } else {
                const serverMessage = result.error || result.message || result.raw || 'Failed to submit inquiry.';
                showContactStatus(`Request failed (${response.status}): ${serverMessage}`, 'error');
                console.error('Contact form request failed:', {
                    status: response.status,
                    response: result
                });
            }
        } catch (error) {
            console.error('Error submitting contact form:', error);
            showContactStatus('Unable to connect to the server.', 'error');
        } finally {
            if (Date.now() >= cooldownUntil) {
                setContactSubmitLoading(false, 'Submit Inquiry');
            }
        }
    });

    const contactFields = contactForm.querySelectorAll('input, textarea');
    contactFields.forEach((field) => {
        field.addEventListener('input', () => {
            field.classList.remove('input-error');
            const group = field.closest('.partner-input-group');
            const err = group ? group.querySelector('.field-error') : null;
            if (err) err.remove();
            clearContactStatus();
        });
    });
});

document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab-btn');
    const cards = document.querySelectorAll('.fleet-card');

    if (tabs.length > 0 && cards.length > 0) {
        tabs.forEach(tab => {
            tab.addEventListener('click', function (e) {
                e.preventDefault();

                tabs.forEach(t => t.classList.remove('active'));
                this.classList.add('active');

                const filterValue = this.getAttribute('data-filter');

                cards.forEach(card => {
                    const category = card.getAttribute('data-category');

                    if (filterValue === 'all' || category === filterValue) {
                        card.style.display = 'flex'; 
                    } else {
                        card.style.display = 'none'; 
                    }
                });
            });
        });
    }
});

document.addEventListener('DOMContentLoaded', () => {
    const plannerFrom = document.getElementById('plannerFrom');
    const plannerDate = document.getElementById('plannerDate');
    const plannerTime = document.getElementById('plannerTime');
    const plannerSwitch = document.getElementById('plannerSwitch');
    const plannerDirectionLabel = document.getElementById('plannerDirectionLabel');
    const destinationPicker = document.getElementById('destinationPicker');
    const destinationPickerTrigger = document.getElementById('destinationPickerTrigger');
    const provinceButtons = document.querySelectorAll('.province-btn');
    const cityOptionsWrap = document.getElementById('cityOptions');
    const cityColumnTitle = document.getElementById('cityColumnTitle');
    const plannerContinueBtn = document.getElementById('plannerContinueBtn');
    const routeQuickButtons = document.querySelectorAll('.airport-select-route');

    const modal = document.getElementById('airportWizardModal');
    const modalOverlay = document.getElementById('airportWizardOverlay');
    const modalClose = document.getElementById('airportWizardClose');
    const wizardStatus = document.getElementById('airportWizardStatus');
    const wizardForm = document.getElementById('airportWizardForm');
    const wizardStep1Continue = document.getElementById('airportStep1Continue');
    const wizardStep2Back = document.getElementById('airportStep2Back');
    const wizardSubmitBtn = document.getElementById('airportWizardSubmit');
    const wizardRoutePreview = document.getElementById('wizardRoutePreview');
    const wizardTransferType = document.getElementById('wizardTransferType');
    const wizardEstimatedPrice = document.getElementById('wizardEstimatedPrice');
    const wizardPickupGroup = document.getElementById('wizardPickupGroup');
    const wizardDropoffGroup = document.getElementById('wizardDropoffGroup');
    const wizardPickup = document.getElementById('wizardPickup');
    const wizardDropoff = document.getElementById('wizardDropoff');

    if (!plannerFrom || !plannerDate || !plannerTime || !destinationPicker || !wizardForm || !modal) return;

    const BOOKING_API_ENDPOINT = '/api/bookings';
    const airportName = 'Bicol International Airport';

    const provinceCities = {
        'Albay': ['Legazpi', 'Daraga', 'Tabaco', 'Sto. Domingo', 'Ligao', 'Polangui', 'Guinobatan', 'Bacacay'],
        'Sorsogon': ['Sorsogon City', 'Pilar', 'Bulan', 'Gubat', 'Bacon', 'Irosin', 'Donsol'],
        'Camarines Sur': ['Naga', 'Iriga City', 'Pili', 'Nabua', 'Libmanan', 'Sipocot', 'Baao']
    };

    const baseFare = {
        'Albay|Legazpi': 750,
        'Albay|Daraga': 750,
        'Albay|Tabaco': 2000,
        'Sorsogon|Pilar': 1800,
        'Sorsogon|Sorsogon City': 2500,
        'Camarines Sur|Naga': 4800,
        'Camarines Sur|Iriga City': 4000
    };

    let selectedProvince = 'Albay';
    let selectedCity = '';
    let isTransferOut = true;
    let currentStep = 1;

    function toggleDestinationPicker() {
        destinationPicker.hidden = !destinationPicker.hidden;
    }

    function getBaseFare(province, city) {
        const key = `${province}|${city}`;
        return baseFare[key] || 1800;
    }

    function setWizardStatus(message, type) {
        if (!wizardStatus) return;
        wizardStatus.textContent = message;
        wizardStatus.className = `contact-form-status is-${type}`;
    }

    function clearWizardStatus() {
        if (!wizardStatus) return;
        wizardStatus.textContent = '';
        wizardStatus.className = 'contact-form-status';
    }

    function setSubmitLoading(isLoading) {
        if (!wizardSubmitBtn) return;
        wizardSubmitBtn.disabled = isLoading;
        wizardSubmitBtn.textContent = isLoading ? 'Sending...' : 'Submit Booking';
    }

    function updatePlannerDirection() {
        plannerFrom.value = isTransferOut ? airportName : (selectedCity ? `${selectedCity}, ${selectedProvince}` : 'Select Destination First');
        destinationPickerTrigger.textContent = isTransferOut
            ? (selectedCity ? `${selectedCity}, ${selectedProvince}` : 'Select Destination')
            : airportName;
        plannerDirectionLabel.textContent = isTransferOut
            ? 'Transfer Type: Airport Transfer Out (Airport to City)'
            : 'Transfer Type: Airport Transfer In (City to Airport)';
    }

    function updateWizardPreview() {
        const routeText = selectedCity
            ? (isTransferOut
                ? `${airportName} to ${selectedCity}, ${selectedProvince}`
                : `${selectedCity}, ${selectedProvince} to ${airportName}`)
            : '-';

        if (wizardRoutePreview) wizardRoutePreview.textContent = routeText;
        if (wizardTransferType) wizardTransferType.textContent = isTransferOut ? 'Airport Transfer Out' : 'Airport Transfer In';

        const checkedVehicle = wizardForm.querySelector('input[name="vehicleType"]:checked');
        const multiplier = checkedVehicle ? Number(checkedVehicle.dataset.multiplier || '1') : 1;
        const estimate = Math.round(getBaseFare(selectedProvince, selectedCity || '') * multiplier);
        if (wizardEstimatedPrice) wizardEstimatedPrice.textContent = selectedCity ? `PHP ${estimate.toLocaleString()}` : 'PHP -';
    }

    function renderCities(province) {
        selectedProvince = province;
        const cities = provinceCities[province] || [];
        if (cityColumnTitle) cityColumnTitle.textContent = `${province} - Cities and Towns`;
        if (!cityOptionsWrap) return;

        cityOptionsWrap.innerHTML = '';
        cities.forEach((city) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `city-btn${city === selectedCity ? ' is-active' : ''}`;
            btn.textContent = city;
            btn.addEventListener('click', () => {
                selectedCity = city;
                destinationPicker.hidden = true;
                updatePlannerDirection();
                updateWizardPreview();
                renderCities(selectedProvince);
            });
            cityOptionsWrap.appendChild(btn);
        });
    }

    function updateWizardAddressFields() {
        if (isTransferOut) {
            wizardPickupGroup.style.display = 'none';
            wizardDropoffGroup.style.display = 'flex';
            wizardPickup.value = airportName;
            wizardDropoff.placeholder = `Drop-off in ${selectedCity || 'destination city'}`;
        } else {
            wizardPickupGroup.style.display = 'flex';
            wizardDropoffGroup.style.display = 'none';
            wizardDropoff.value = airportName;
            wizardPickup.placeholder = `Pick-up in ${selectedCity || 'destination city'}`;
        }
    }

    function setStep(step) {
        currentStep = step;
        wizardForm.querySelectorAll('.airport-wizard-step').forEach((panel) => {
            panel.classList.toggle('is-active', panel.dataset.step === String(step));
        });
        modal.querySelectorAll('[data-step-indicator]').forEach((chip) => {
            chip.classList.toggle('is-active', chip.dataset.stepIndicator === String(step));
        });
    }

    function openModal() {
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
        clearWizardStatus();
        updateWizardAddressFields();
        updateWizardPreview();
        setStep(1);
    }

    function closeModal() {
        modal.hidden = true;
        document.body.style.overflow = '';
        clearWizardStatus();
    }

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    plannerDate.min = `${yyyy}-${mm}-${dd}`;

    provinceButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            provinceButtons.forEach((item) => item.classList.remove('is-active'));
            btn.classList.add('is-active');
            selectedCity = '';
            renderCities(btn.dataset.province || 'Albay');
            updatePlannerDirection();
            updateWizardPreview();
        });
    });

    destinationPickerTrigger.addEventListener('click', () => {
        toggleDestinationPicker();
    });

    plannerFrom.addEventListener('click', () => {
        toggleDestinationPicker();
    });

    plannerFrom.style.cursor = 'pointer';

    document.addEventListener('click', (e) => {
        if (destinationPicker.hidden) return;
        if (!destinationPicker.contains(e.target) && e.target !== destinationPickerTrigger) {
            destinationPicker.hidden = true;
        }
    });

    plannerSwitch.addEventListener('click', () => {
        if (!selectedCity) {
            setWizardStatus('Select destination first before switching transfer direction.', 'error');
            return;
        }
        clearWizardStatus();
        isTransferOut = !isTransferOut;
        destinationPicker.hidden = true;
        updatePlannerDirection();
        updateWizardAddressFields();
        updateWizardPreview();
    });

    routeQuickButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const province = btn.dataset.province;
            const city = btn.dataset.city;
            if (!province || !city) return;

            selectedProvince = province;
            selectedCity = city;
            provinceButtons.forEach((item) => {
                item.classList.toggle('is-active', item.dataset.province === province);
            });
            renderCities(province);
            updatePlannerDirection();
            updateWizardPreview();
            document.getElementById('airport-planner')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    });

    plannerContinueBtn.addEventListener('click', () => {
        if (!selectedCity) {
            setWizardStatus('Please select your destination city/town.', 'error');
            return;
        }
        if (!plannerDate.value || !plannerTime.value) {
            setWizardStatus('Please choose transfer date and time.', 'error');
            return;
        }
        clearWizardStatus();
        openModal();
    });

    modalOverlay?.addEventListener('click', closeModal);
    modalClose?.addEventListener('click', closeModal);

    wizardForm.querySelectorAll('input[name="vehicleType"]').forEach((input) => {
        input.addEventListener('change', updateWizardPreview);
    });

    wizardStep1Continue?.addEventListener('click', () => {
        const vehicleChosen = wizardForm.querySelector('input[name="vehicleType"]:checked');
        const flightNumber = document.getElementById('wizardFlightNumber');
        const transferAddressOk = isTransferOut ? wizardDropoff.value.trim() : wizardPickup.value.trim();

        if (!vehicleChosen) {
            setWizardStatus('Please choose a vehicle type.', 'error');
            return;
        }
        if (!flightNumber || !flightNumber.value.trim()) {
            setWizardStatus('Flight number is required.', 'error');
            return;
        }
        if (!transferAddressOk) {
            setWizardStatus(isTransferOut ? 'Please provide drop-off location.' : 'Please provide pick-up location.', 'error');
            return;
        }

        clearWizardStatus();
        setStep(2);
    });

    wizardStep2Back?.addEventListener('click', () => {
        clearWizardStatus();
        setStep(1);
    });

    wizardForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        clearWizardStatus();

        const formData = new FormData(wizardForm);
        const formValues = Object.fromEntries(formData.entries());
        const selectedVehicle = wizardForm.querySelector('input[name="vehicleType"]:checked');
        const multiplier = selectedVehicle ? Number(selectedVehicle.dataset.multiplier || '1') : 1;
        const estimate = Math.round(getBaseFare(selectedProvince, selectedCity) * multiplier);

        if (!formValues.client_name || !formValues.contact_no || !formValues.email) {
            setWizardStatus('Please complete client details.', 'error');
            return;
        }

        const route = isTransferOut
            ? `${airportName} to ${selectedCity}, ${selectedProvince}`
            : `${selectedCity}, ${selectedProvince} to ${airportName}`;

        const pickupAddress = isTransferOut ? airportName : (formValues.pickup_address || '—');
        const dropoffAddress = isTransferOut ? (formValues.dropoff_address || '—') : airportName;

        const payload = {
            client_name: formValues.client_name,
            contact_no: formValues.contact_no,
            email: formValues.email,
            area: selectedProvince,
            rentalType: 'with-driver',
            serviceOption: `${isTransferOut ? 'Airport Transfer Out' : 'Airport Transfer In'} - ${route} (Est. PHP ${estimate.toLocaleString()})`,
            vehicleType: formValues.vehicleType || 'Sedan',
            passengers: formValues.passengers || '1',
            pickup_date: plannerDate.value,
            pickup_time: plannerTime.value,
            pickup_address: pickupAddress,
            itinerary: `Flight Number: ${formValues.flight_number || '—'} | Drop-off: ${dropoffAddress}`
        };

        try {
            setSubmitLoading(true);

            const response = await fetch(BOOKING_API_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const rawBody = await response.text();
            let result = {};
            try {
                result = rawBody ? JSON.parse(rawBody) : {};
            } catch {
                result = { raw: rawBody };
            }

            if (response.ok && result.success && result.booking) {
                setWizardStatus(`Booking submitted. Reference: ${result.booking.ref}`, 'success');
                wizardForm.reset();
                selectedCity = '';
                isTransferOut = true;
                renderCities(selectedProvince);
                updatePlannerDirection();
                updateWizardPreview();
                setTimeout(() => {
                    closeModal();
                }, 1200);
            } else {
                const msg = result.error || result.message || result.raw || `HTTP ${response.status}`;
                setWizardStatus(`Booking failed: ${msg}`, 'error');
            }
        } catch (error) {
            console.error('Airport wizard booking error:', error);
            setWizardStatus('Unable to connect to server. Please try again.', 'error');
        } finally {
            setSubmitLoading(false);
        }
    });

    wizardForm.querySelectorAll('input, select, textarea').forEach((field) => {
        field.addEventListener('input', clearWizardStatus);
        field.addEventListener('change', clearWizardStatus);
    });

    renderCities(selectedProvince);
    updatePlannerDirection();
    updateWizardPreview();
});

// --- NAV HIGHLIGHT (active link) ---
document.addEventListener('DOMContentLoaded', () => {
    const navLinks = document.querySelectorAll('.navbar__links');
    const current = window.location.pathname.split('/').pop() || 'index.html';
    navLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href === current || (href === 'index.html' && current === '')) {
            link.classList.add('active');
        }
        // Also support anchors (e.g., #partner)
        if (href.startsWith('#') && window.location.hash === href) {
            link.classList.add('active');
        }

        // Close mobile menu after clicking a link
        link.addEventListener('click', () => {
            if (link === servicesDropdownTrigger) {
                return;
            }

            if (menuLinks && menuLinks.classList.contains('active')) {
                syncMenuState(false);
            }
        });

        // Smooth scroll for anchors
        if (href.startsWith('#')) {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const target = document.querySelector(href);
                if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
        }
    });
});

// test update vercel production triggers